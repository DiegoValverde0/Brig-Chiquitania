import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { exigirEnum, exigirObjeto } from '../../common/validacion';
import { HistorialEstado } from '../operaciones/entities/historial-estado.entity';
import { TipoEventoHistorial } from '../operaciones/enums/tipo-evento-historial.enum';
import { aEntradaHistorial, EntradaHistorial, HistorialEstadoService } from '../operaciones/historial-estado.service';
import { vistaCarta, VistaCarta } from './carta-municipal.service';
import { Incidente } from './entities/incidente.entity';
import { EstadoIncidente } from './enums/estado-incidente.enum';
import { NivelRiesgo } from './enums/nivel-riesgo.enum';
import { OrigenRiesgo } from './enums/origen-riesgo.enum';
import { FactoresRiesgo } from './motor-riesgo.service';

/** HU-2.2 / RF-06: mínimo de caracteres de la justificación de una reclasificación manual. */
export const JUSTIFICACION_MINIMA = 15;
export const JUSTIFICACION_MAXIMA = 500;

/** Vista de la pantalla "Evaluación de riesgo" (CU-02, Figura 8): lo que calculó el motor y lo que decidió un humano. */
export interface EvaluacionIncidente {
  id: string;
  estado: EstadoIncidente;
  fechaReporte: Date;
  nivelRiesgo: NivelRiesgo | null;
  origenRiesgo: OrigenRiesgo;
  /** Explicación del motor (RF-05); se conserva aunque se haya reclasificado. */
  justificacionAlgoritmo: string | null;
  factores: FactoresRiesgo | null;
  comunidad: { id: string; nombre: string } | null;
  coordenada: { latitud: number; longitud: number; precisionMetros: number | null };
  reclasificaciones: EntradaHistorial[];
  /** Trámite municipal (Ley 602, Bolt 3): para validarla o rechazarla desde el mismo detalle. */
  carta: VistaCarta | null;
}

@Injectable()
export class EvaluacionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
  ) {}

  async evaluacion(incidenteId: string): Promise<EvaluacionIncidente> {
    const i = await this.dataSource
      .getRepository(Incidente)
      .findOne({ where: { id: incidenteId }, relations: { comunidad: true, cartaMunicipal: true } });
    if (!i) throw new NotFoundException('Incidente no encontrado');
    const reclasificaciones = await this.dataSource.getRepository(HistorialEstado).find({
      where: { incidente: { id: incidenteId }, tipoEvento: TipoEventoHistorial.Reclasificacion },
      relations: { usuario: true },
      order: { creadoEn: 'ASC' },
    });
    return {
      id: i.id,
      estado: i.estado,
      fechaReporte: i.fechaReporte,
      nivelRiesgo: i.nivelRiesgo,
      origenRiesgo: i.origenRiesgo,
      justificacionAlgoritmo: i.justificacionRiesgo,
      factores: i.factoresRiesgo,
      comunidad: i.comunidad ? { id: i.comunidad.id, nombre: i.comunidad.nombre } : null,
      coordenada: {
        latitud: i.coordenada.latitud,
        longitud: i.coordenada.longitud,
        precisionMetros: i.coordenada.precisionMetros,
      },
      reclasificaciones: reclasificaciones.map(aEntradaHistorial),
      carta: i.cartaMunicipal ? vistaCarta(i.cartaMunicipal) : null,
    };
  }

  /**
   * CU-06 / HU-2.2: el coordinador sobrescribe el nivel con una justificación obligatoria (≥15 caracteres).
   * Queda registrado quién, cuándo, el motivo y los niveles anterior y nuevo, en el historial append-only.
   * La decisión humana puede habilitar o bloquear el despacho (RS-03: nunca lo decide el sistema solo).
   */
  async reclasificar(incidenteId: string, body: unknown, usuarioId: string): Promise<EvaluacionIncidente> {
    const datos = exigirObjeto(body);
    const nivelNuevo = exigirEnum(datos.nivelRiesgo, 'nivelRiesgo', Object.values(NivelRiesgo));
    const justificacion = typeof datos.justificacion === 'string' ? datos.justificacion.trim() : '';
    if (justificacion.length < JUSTIFICACION_MINIMA) {
      throw new BadRequestException(
        `La justificación es obligatoria y debe tener al menos ${JUSTIFICACION_MINIMA} caracteres (tiene ${justificacion.length})`,
      );
    }
    if (justificacion.length > JUSTIFICACION_MAXIMA) {
      throw new BadRequestException(`La justificación no puede superar los ${JUSTIFICACION_MAXIMA} caracteres`);
    }

    await this.dataSource.transaction(async (em) => {
      const incidente = await em.findOne(Incidente, {
        where: { id: incidenteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!incidente) throw new NotFoundException('Incidente no encontrado');
      if (incidente.estado === EstadoIncidente.Cerrado) {
        throw new ConflictException('El incidente está cerrado: ya no se puede reclasificar');
      }
      if (incidente.nivelRiesgo === nivelNuevo) {
        throw new UnprocessableEntityException(`El incidente ya tiene riesgo ${nivelNuevo}`);
      }
      await em.update(Incidente, { id: incidenteId }, { nivelRiesgo: nivelNuevo, origenRiesgo: OrigenRiesgo.Manual });
      await this.historial.registrarReclasificacion(
        em,
        incidente,
        incidente.nivelRiesgo,
        nivelNuevo,
        justificacion,
        usuarioId,
      );
    });
    return this.evaluacion(incidenteId);
  }
}
