import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AsignacionDespacho } from '../despacho/entities/asignacion-despacho.entity';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { AuditoriaService } from './auditoria.service';
import { leerBitacora } from './bitacora';
import { Bitacora } from './entities/bitacora.entity';
import { NivelAgua, NivelCombustible } from './enums/nivel-bitacora.enum';
import { TipoEventoAuditoria } from './enums/tipo-evento-auditoria.enum';

/** Se registra bitácora entre la llegada y el cierre (HU-5.2; CU-05: llegada → checklist → cierre). */
export const ESTADOS_CON_BITACORA = [EstadoIncidente.En_Atencion, EstadoIncidente.En_Liquidacion];

export interface VistaBitacora {
  id: string;
  fecha: Date;
  nivelAgua: NivelAgua;
  nivelCombustible: NivelCombustible;
  herramientasOperativas: boolean;
  kmFajaMitigados: number;
  porcentajeControl: number;
  controlRetrocede: boolean;
  canal: string;
  brigada: string;
  registradaPor: string | null;
}

export function vistaBitacora(b: Bitacora): VistaBitacora {
  return {
    id: b.id,
    fecha: b.fecha,
    nivelAgua: b.nivelAgua,
    nivelCombustible: b.nivelCombustible,
    herramientasOperativas: b.herramientasOperativas,
    kmFajaMitigados: b.kmFajaMitigados,
    porcentajeControl: b.porcentajeControl,
    controlRetrocede: b.controlRetrocede,
    canal: b.canal,
    brigada: b.brigada?.nombre ?? '',
    registradaPor: b.usuario?.nombre ?? null,
  };
}

/**
 * CU-15 / HU-5.2 / RF-12: bitácora de turno. La registra el jefe de la brigada asignada al foco; idempotente por
 * el UUID del teléfono (reintentar por datos o por SMS no duplica); inmutable una vez guardada (append-only).
 */
@Injectable()
export class BitacoraService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditoriaService,
  ) {}

  async registrar(
    incidenteId: string,
    body: unknown,
    usuario: Usuario,
    canal: 'App' | 'SMS' = 'App',
  ): Promise<{ bitacora: VistaBitacora; duplicada: boolean }> {
    const datos = leerBitacora(body);
    const resultado = await this.dataSource.transaction(async (em) => {
      const incidente = await em.findOne(Incidente, { where: { id: incidenteId }, lock: { mode: 'pessimistic_write' } });
      if (!incidente) throw new NotFoundException('Incidente no encontrado');
      const previa = await em.findOne(Bitacora, { where: { id: datos.id }, relations: { incidente: true } });
      if (previa) {
        if (previa.incidente.id !== incidenteId) throw new ConflictException('Ese id de bitácora ya se usó en otro foco');
        return { id: previa.id, duplicada: true };
      }
      if (!ESTADOS_CON_BITACORA.includes(incidente.estado)) {
        throw new ConflictException(
          `El foco está "${incidente.estado}": la bitácora se registra entre la llegada y el cierre`,
        );
      }
      const asignacion = await em.findOne(AsignacionDespacho, {
        where: { incidente: { id: incidenteId } },
        relations: { brigada: { jefe: true } },
        order: { fechaAsignacion: 'DESC' },
      });
      if (!asignacion) throw new ConflictException('El foco no tiene brigada asignada');
      if (usuario.rol !== Rol.JefeBrigada || asignacion.brigada.jefe?.id !== usuario.id) {
        throw new ForbiddenException('Solo el jefe de la brigada asignada a este foco registra su bitácora');
      }
      const anterior = await em.findOne(Bitacora, {
        where: { incidente: { id: incidenteId } },
        order: { fecha: 'DESC' },
      });
      // Decisión 7.4 del PO: el % de control puede bajar (rebrote), pero queda marcado para el informe.
      const controlRetrocede = !!anterior && datos.porcentajeControl < anterior.porcentajeControl;
      await em.insert(Bitacora, {
        ...datos,
        controlRetrocede,
        canal,
        incidente: { id: incidenteId },
        brigada: { id: asignacion.brigada.id },
        usuario: { id: usuario.id },
      });
      await this.auditoria.registrar(em, {
        tipo: TipoEventoAuditoria.BitacoraRegistrada,
        entidad: 'incidente',
        entidadId: incidenteId,
        incidenteId,
        detalle:
          `${asignacion.brigada.nombre} (${canal}): agua ${datos.nivelAgua}, combustible ${datos.nivelCombustible}, ` +
          `herramientas ${datos.herramientasOperativas ? 'operativas' : 'con fallas'}, ${datos.kmFajaMitigados} km de faja, ` +
          `${datos.porcentajeControl} % de control${controlRetrocede ? ' (el control bajó)' : ''}`,
        usuarioId: usuario.id,
      });
      return { id: datos.id, duplicada: false };
    });
    const guardada = await this.dataSource
      .getRepository(Bitacora)
      .findOneOrFail({ where: { id: resultado.id }, relations: { brigada: true, usuario: true } });
    return { bitacora: vistaBitacora(guardada), duplicada: resultado.duplicada };
  }

  /** Bitácoras del foco, en orden. El coordinador ve todas; el jefe, solo las de un foco de su brigada. */
  async listar(incidenteId: string, usuario: Usuario): Promise<VistaBitacora[]> {
    if (!(await this.dataSource.getRepository(Incidente).existsBy({ id: incidenteId }))) {
      throw new NotFoundException('Incidente no encontrado');
    }
    if (usuario.rol === Rol.JefeBrigada) {
      const suya = await this.dataSource.getRepository(AsignacionDespacho).exists({
        where: { incidente: { id: incidenteId }, brigada: { jefe: { id: usuario.id } } },
      });
      if (!suya) throw new ForbiddenException('El foco no es de su brigada');
    }
    const lista = await this.dataSource.getRepository(Bitacora).find({
      where: { incidente: { id: incidenteId } },
      relations: { brigada: true, usuario: true },
      order: { fecha: 'ASC' },
    });
    return lista.map(vistaBitacora);
  }

  /** Último % de control de cada foco (tarjetas del panel). */
  async ultimoControl(incidenteIds: string[]): Promise<Map<string, number>> {
    if (!incidenteIds.length) return new Map();
    const filas: Array<{ incidente_id: string; porcentaje_control: number }> = await this.dataSource.query(
      `SELECT DISTINCT ON (incidente_id) incidente_id, porcentaje_control FROM bitacora
        WHERE incidente_id = ANY($1) ORDER BY incidente_id, fecha DESC`,
      [incidenteIds],
    );
    return new Map(filas.map((f) => [f.incidente_id, Number(f.porcentaje_control)]));
  }
}
