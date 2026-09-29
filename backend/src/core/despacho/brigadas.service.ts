import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { exigirEnum, exigirObjeto } from '../../common/validacion';
import { AuditoriaService } from '../operaciones/auditoria.service';
import { TipoEventoAuditoria } from '../operaciones/enums/tipo-evento-auditoria.enum';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { Brigada } from './entities/brigada.entity';
import { EstadoBrigada } from './enums/estado-brigada.enum';
import { ESTADOS_TACTICOS_REPORTABLES, validarTransicionTactica } from './estado-tactico';

/** Estados del incidente en los que una brigada sigue comprometida con él. */
export const ESTADOS_INCIDENTE_ACTIVOS = [EstadoIncidente.Asignado, EstadoIncidente.En_Atencion, EstadoIncidente.En_Liquidacion];

export interface VistaBrigada {
  id: string;
  nombre: string;
  estadoOperativo: EstadoBrigada;
  ubicacion: { latitud: number; longitud: number };
  jefe: { id: string; nombre: string } | null;
  /** Foco al que está asignada (el más reciente aún activo), o null. */
  incidente: { id: string; estado: EstadoIncidente; nivelRiesgo: NivelRiesgo | null; comunidad: string | null } | null;
}

/** RF-08: estados tácticos de brigada y su vínculo con el foco asignado. */
@Injectable()
export class BrigadasService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(em: EntityManager = this.dataSource.manager): Promise<VistaBrigada[]> {
    const brigadas = await em.find(Brigada, { relations: { jefe: true }, order: { nombre: 'ASC' } });
    const asignaciones = await em.find(AsignacionDespacho, {
      where: { incidente: { estado: In(ESTADOS_INCIDENTE_ACTIVOS) } },
      relations: { brigada: true, incidente: { comunidad: true } },
      order: { fechaAsignacion: 'DESC' },
    });
    return brigadas.map((b) => {
      // Una brigada liberada ("Disponible") ya no responde por el foco, aunque este siga abierto hasta su cierre.
      const activa =
        b.estadoOperativo === EstadoBrigada.Disponible ? undefined : asignaciones.find((a) => a.brigada.id === b.id);
      return {
        id: b.id,
        nombre: b.nombre,
        estadoOperativo: b.estadoOperativo,
        ubicacion: { latitud: b.ubicacionActual.latitud, longitud: b.ubicacionActual.longitud },
        jefe: b.jefe ? { id: b.jefe.id, nombre: b.jefe.nombre } : null,
        incidente: activa
          ? {
              id: activa.incidente.id,
              estado: activa.incidente.estado,
              nivelRiesgo: activa.incidente.nivelRiesgo,
              comunidad: activa.incidente.comunidad?.nombre ?? null,
            }
          : null,
      };
    });
  }

  /** La brigada que lidera el jefe autenticado. */
  async mia(usuario: Usuario): Promise<VistaBrigada> {
    const brigada = await this.dataSource.getRepository(Brigada).findOneBy({ jefe: { id: usuario.id } });
    if (!brigada) throw new NotFoundException('No tiene una brigada asignada: consulte a la central');
    return (await this.listar()).find((b) => b.id === brigada.id)!;
  }

  /**
   * RF-08 / Acta ACTA-002 (acuerdo 4): el jefe reporta "En Liquidación / Por Finalizar" (y su foco pasa a
   * "En Liquidación"); el coordinador libera la brigada ("Disponible"). Auditado; transiciones inválidas → 409.
   */
  async reportarEstado(brigadaId: string, body: unknown, usuario: Usuario): Promise<VistaBrigada> {
    const nuevo = exigirEnum(exigirObjeto(body).estado, 'estado', [...ESTADOS_TACTICOS_REPORTABLES]);
    await this.dataSource.transaction(async (em) => {
      const brigada = await em.findOne(Brigada, { where: { id: brigadaId }, lock: { mode: 'pessimistic_write' } });
      if (!brigada) throw new NotFoundException('Brigada no encontrada');
      const conJefe = await em.findOneOrFail(Brigada, { where: { id: brigadaId }, relations: { jefe: true } });
      const error = validarTransicionTactica(brigada.estadoOperativo, nuevo, usuario.rol, conJefe.jefe?.id === usuario.id);
      if (error) throw error.tipo === 'prohibido' ? new ForbiddenException(error.mensaje) : new ConflictException(error.mensaje);

      await em.update(Brigada, { id: brigadaId }, { estadoOperativo: nuevo });
      const asignacion = await em.findOne(AsignacionDespacho, {
        where: { brigada: { id: brigadaId }, incidente: { estado: In(ESTADOS_INCIDENTE_ACTIVOS) } },
        relations: { incidente: true },
        order: { fechaAsignacion: 'DESC' },
      });
      const incidente = asignacion?.incidente ?? null;
      // Ciclo del PRD: En atención → En Liquidación cuando la brigada reporta que está por finalizar [inferencia aprobada].
      if (nuevo === EstadoBrigada.En_Liquidacion && incidente?.estado === EstadoIncidente.En_Atencion) {
        await em.update(Incidente, { id: incidente.id }, { estado: EstadoIncidente.En_Liquidacion });
        await this.historial.registrarCambio(
          em,
          incidente,
          EstadoIncidente.En_Atencion,
          EstadoIncidente.En_Liquidacion,
          `${brigada.nombre} reporta "En Liquidación / Por Finalizar"`,
          usuario.id,
        );
      }
      await this.auditoria.registrar(em, {
        tipo: TipoEventoAuditoria.BrigadaEstadoTactico,
        entidad: 'brigada',
        entidadId: brigadaId,
        incidenteId: incidente?.id ?? null,
        detalle: `${brigada.nombre}: ${brigada.estadoOperativo} → ${nuevo}`,
        usuarioId: usuario.id,
      });
    });
    return (await this.listar()).find((b) => b.id === brigadaId)!;
  }
}
