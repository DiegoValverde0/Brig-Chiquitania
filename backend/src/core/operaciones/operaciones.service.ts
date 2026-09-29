import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull, Not } from 'typeorm';
import { exigirNumero, exigirObjeto, exigirPunto, fechaDelCliente } from '../../common/validacion';
import { AsignacionDespacho } from '../despacho/entities/asignacion-despacho.entity';
import { Brigada } from '../despacho/entities/brigada.entity';
import { EstadoBrigada } from '../despacho/enums/estado-brigada.enum';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { HistorialEstado } from './entities/historial-estado.entity';
import { aEntradaHistorial, EntradaHistorial, HistorialEstadoService } from './historial-estado.service';

export type { EntradaHistorial };

/** Línea base histórica de la temporada 2024 (PRD §2.2). */
export const LINEA_BASE_MIN = 180;
/** Meta del proyecto: reducir el tiempo de despacho en un 30 %. */
export const META_AHORRO_PCT = 30;

export interface TiempoDespacho {
  incidenteId: string;
  fechaReporte: Date;
  fechaLlegada: Date;
  deltaMinutos: number;
  lineaBaseMinutos: number;
  ahorroPct: number;
  cumpleMeta: boolean;
}


@Injectable()
export class OperacionesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
  ) {}

  /** HU-5.1: registra hora y GPS de llegada (write-once); foco "En atención", brigada "En Combate Activo". */
  async confirmarLlegada(asignacionId: string, body: unknown, usuarioId: string | null = null): Promise<TiempoDespacho> {
    const datos = exigirObjeto(body);
    const punto = exigirPunto(datos);
    const precisionMetros =
      datos.precisionMetros === undefined ? null : exigirNumero(datos.precisionMetros, 'precisionMetros', 0, 10000);
    const llegada = fechaDelCliente(datos.fechaLlegada, 'fechaLlegada');

    await this.dataSource.transaction(async (em) => {
      // Bloqueo de la fila (sin joins: FOR UPDATE no admite el lado nulo de un LEFT JOIN).
      const bloqueada = await em.findOne(AsignacionDespacho, {
        where: { id: asignacionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!bloqueada) throw new NotFoundException('Asignación no encontrada');
      if (bloqueada.timestampConfirmacionLlegada) {
        throw new ConflictException('La llegada ya fue confirmada');
      }
      const { incidente, brigada } = await em.findOneOrFail(AsignacionDespacho, {
        where: { id: asignacionId },
        relations: { incidente: true, brigada: true },
      });
      if (incidente.estado !== EstadoIncidente.Asignado) {
        throw new ConflictException(`El incidente está "${incidente.estado}"; se esperaba "Asignado"`);
      }
      if (llegada.getTime() < incidente.fechaReporte.getTime()) {
        throw new ConflictException('fechaLlegada no puede ser anterior a la fecha del reporte');
      }

      await em.update(AsignacionDespacho, { id: asignacionId }, { timestampConfirmacionLlegada: llegada });
      await em.update(Incidente, { id: incidente.id }, { estado: EstadoIncidente.En_Atencion });
      await em.update(
        Brigada,
        { id: brigada.id },
        {
          estadoOperativo: EstadoBrigada.En_Combate_Activo,
          ubicacionActual: { ...punto, precisionMetros },
          version: () => 'version + 1',
        },
      );
      const delta = redondear(incidente.calcularTiempoDespacho(llegada));
      // El ΔT queda además asentado en el historial append-only (RNF-07).
      await this.historial.registrarCambio(
        em,
        incidente,
        EstadoIncidente.Asignado,
        EstadoIncidente.En_Atencion,
        `Llegada confirmada por ${brigada.nombre}. ΔT = ${delta} min (línea base ${LINEA_BASE_MIN} min)`,
        usuarioId,
      );
    });
    const asignacion = await this.dataSource
      .getRepository(AsignacionDespacho)
      .findOneOrFail({ where: { id: asignacionId }, relations: { incidente: true } });
    return this.tiempoDespacho(asignacion.incidente.id);
  }

  /** HU-5.3: ΔT = T_llegada − T_reporte y % de ahorro frente a la línea base de 180 min. */
  async tiempoDespacho(incidenteId: string): Promise<TiempoDespacho> {
    const incidente = await this.dataSource.getRepository(Incidente).findOneBy({ id: incidenteId });
    if (!incidente) throw new NotFoundException('Incidente no encontrado');
    const primeraLlegada = await this.dataSource.getRepository(AsignacionDespacho).findOne({
      where: { incidente: { id: incidenteId }, timestampConfirmacionLlegada: Not(IsNull()) },
      order: { timestampConfirmacionLlegada: 'ASC' },
    });
    if (!primeraLlegada?.timestampConfirmacionLlegada) {
      throw new ConflictException('Aún no hay llegada confirmada para este incidente');
    }
    const llegada = primeraLlegada.timestampConfirmacionLlegada;
    const delta = incidente.calcularTiempoDespacho(llegada);
    const ahorro = ((LINEA_BASE_MIN - delta) / LINEA_BASE_MIN) * 100;
    return {
      incidenteId,
      fechaReporte: incidente.fechaReporte,
      fechaLlegada: llegada,
      deltaMinutos: redondear(delta),
      lineaBaseMinutos: LINEA_BASE_MIN,
      ahorroPct: redondear(ahorro),
      cumpleMeta: ahorro >= META_AHORRO_PCT,
    };
  }

  async historialDe(incidenteId: string): Promise<EntradaHistorial[]> {
    if (!(await this.dataSource.getRepository(Incidente).existsBy({ id: incidenteId }))) {
      throw new NotFoundException('Incidente no encontrado');
    }
    const entradas = await this.dataSource.getRepository(HistorialEstado).find({
      where: { incidente: { id: incidenteId } },
      relations: { usuario: true },
      order: { creadoEn: 'ASC' },
    });
    return entradas.map(aEntradaHistorial);
  }
}

function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}
