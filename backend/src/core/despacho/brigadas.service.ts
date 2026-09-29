import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { exigirEnum, exigirObjeto, exigirUuid } from '../../common/validacion';
import { AuditoriaService } from '../operaciones/auditoria.service';
import { TipoEventoAuditoria } from '../operaciones/enums/tipo-evento-auditoria.enum';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { Brigada } from './entities/brigada.entity';
import { EstadoBrigada } from './enums/estado-brigada.enum';
import { ESTADOS_TACTICOS_REPORTABLES, validarTransicionTactica } from './estado-tactico';
import { NotificacionesService } from './notificaciones.service';
import type { ResumenNotificacion } from './panel';

/** Estados del incidente en los que una brigada sigue comprometida con él. */
export const ESTADOS_INCIDENTE_ACTIVOS = [EstadoIncidente.Asignado, EstadoIncidente.En_Atencion, EstadoIncidente.En_Liquidacion];

export interface VistaBrigada {
  id: string;
  nombre: string;
  estadoOperativo: EstadoBrigada;
  ubicacion: { latitud: number; longitud: number };
  jefe: { id: string; nombre: string } | null;
  /** Decisión 7.4 del PO: sin jefe con teléfono no se despacha (no habría a quién notificar). */
  jefeConTelefono: boolean;
  /** Bloqueo optimista (Bolt 4): el despacho envía la versión que vio. */
  version: number;
  /** Foco al que está asignada (el más reciente aún activo), o null. */
  incidente: { id: string; estado: EstadoIncidente; nivelRiesgo: NivelRiesgo | null; comunidad: string | null } | null;
}

export interface OrdenDeBrigada {
  asignacionId: string;
  fechaAsignacion: Date;
  rutaSugerida: string | null;
  llegadaConfirmada: boolean;
  incidente: {
    id: string;
    estado: EstadoIncidente;
    nivelRiesgo: NivelRiesgo | null;
    latitud: number;
    longitud: number;
    comunidad: string | null;
  };
  contacto: { nombre: string; telefono: string; cargo: string } | null;
  notificacion: ResumenNotificacion | null;
}

/** RF-08: estados tácticos de brigada y su vínculo con el foco asignado. */
@Injectable()
export class BrigadasService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesService,
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
        jefeConTelefono: tieneJefeConTelefono(b),
        version: b.version,
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

  /** Asigna (o cambia) el jefe de la brigada: un usuario activo con rol JefeBrigada (1–1). Solo Coordinador. */
  async asignarJefe(brigadaId: string, body: unknown, usuarioId: string): Promise<VistaBrigada> {
    const jefeId = exigirUuid(exigirObjeto(body).usuarioId, 'usuarioId');
    await this.dataSource.transaction(async (em) => {
      const brigada = await em.findOne(Brigada, { where: { id: brigadaId }, lock: { mode: 'pessimistic_write' } });
      if (!brigada) throw new NotFoundException('Brigada no encontrada');
      const jefe = await em.findOneBy(Usuario, { id: jefeId });
      if (!jefe || !jefe.activo || jefe.rol !== Rol.JefeBrigada) {
        throw new UnprocessableEntityException('El usuario no existe, no está activo o no es Jefe de Brigada');
      }
      const otra = await em.findOne(Brigada, { where: { jefe: { id: jefeId } } });
      if (otra && otra.id !== brigadaId) throw new ConflictException(`El usuario ya lidera ${otra.nombre}`);
      await em.update(Brigada, { id: brigadaId }, { jefe: { id: jefeId } });
      await this.auditoria.registrar(em, {
        tipo: TipoEventoAuditoria.BrigadaJefe,
        entidad: 'brigada',
        entidadId: brigadaId,
        incidenteId: null,
        detalle: `${brigada.nombre}: jefe ${jefe.nombre}${jefe.telefono ? '' : ' (sin teléfono registrado)'}`,
        usuarioId,
      });
    });
    return (await this.listar()).find((b) => b.id === brigadaId)!;
  }

  /** La brigada que lidera el jefe autenticado, con su orden de salida vigente (Bolt 4). */
  async mia(usuario: Usuario): Promise<VistaBrigada & { orden: OrdenDeBrigada | null }> {
    const brigada = await this.dataSource.getRepository(Brigada).findOneBy({ jefe: { id: usuario.id } });
    if (!brigada) throw new NotFoundException('No tiene una brigada asignada: consulte a la central');
    const vista = (await this.listar()).find((b) => b.id === brigada.id)!;
    return { ...vista, orden: vista.incidente ? await this.orden(brigada.id) : null };
  }

  /**
   * HU-4.2: orden de salida para el jefe: coordenadas del foco, ruta en línea recta, contacto comunal (Acta
   * ACTA-002, acuerdo 5), cronómetro desde la asignación y estado del aviso.
   */
  private async orden(brigadaId: string): Promise<OrdenDeBrigada | null> {
    const a = await this.dataSource.getRepository(AsignacionDespacho).findOne({
      where: { brigada: { id: brigadaId }, incidente: { estado: In(ESTADOS_INCIDENTE_ACTIVOS) } },
      relations: { incidente: { comunidad: { contacto: true } } },
      order: { fechaAsignacion: 'DESC' },
    });
    if (!a) return null;
    const i = a.incidente;
    const contacto = i.comunidad?.contacto;
    return {
      asignacionId: a.id,
      fechaAsignacion: a.fechaAsignacion,
      rutaSugerida: a.rutaSugerida,
      llegadaConfirmada: !!a.timestampConfirmacionLlegada,
      incidente: {
        id: i.id,
        estado: i.estado,
        nivelRiesgo: i.nivelRiesgo,
        latitud: i.coordenada.latitud,
        longitud: i.coordenada.longitud,
        comunidad: i.comunidad?.nombre ?? null,
      },
      contacto:
        contacto && contacto.validarNoVacio()
          ? { nombre: contacto.nombreAutoridad, telefono: contacto.telefono, cargo: contacto.cargo }
          : null,
      notificacion: (await this.notificaciones.resumenPorIncidente([i.id])).get(i.id) ?? null,
    };
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

      await em.update(Brigada, { id: brigadaId }, { estadoOperativo: nuevo, version: () => 'version + 1' });
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

/** Decisión 7.4 del PO: la brigada necesita un jefe activo con teléfono para recibir la orden (push o SMS). */
export function tieneJefeConTelefono(b: Brigada): boolean {
  return !!b.jefe && b.jefe.activo && !!b.jefe.telefono && b.jefe.telefono.trim().length > 0;
}
