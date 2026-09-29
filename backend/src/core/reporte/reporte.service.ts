import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { PuntoGeo, puntoDestino } from '../../common/geo';
import {
  exigirEnum,
  exigirNumero,
  exigirObjeto,
  exigirPunto,
  exigirUuid,
  fechaDelCliente,
} from '../../common/validacion';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { MotorRiesgoService } from '../triage/motor-riesgo.service';
import { Comunidad } from './entities/comunidad.entity';
import { Rumbo } from './enums/rumbo.enum';
import { TipoReporte } from './enums/tipo-reporte.enum';

/** Precisión máxima aceptada para un GPS nativo (RF-01). */
export const PRECISION_MAXIMA_M = 15;
/** Alcance máximo razonable de un avistamiento de humo a distancia (HU-1.2) [inferencia]. */
export const DISTANCIA_AVISTAMIENTO_MAX_KM = 50;

const GRADOS_RUMBO: Record<Rumbo, number> = { N: 0, E: 90, S: 180, O: 270 };

/** Canal por el que llegó el reporte: la app (datos) o el fallback SMS (RNF-02). */
export type OrigenReporte = 'App' | 'SMS';

/** Reporte ya validado, independiente del canal (JSON de la app o SMS compacto). */
export type SolicitudReporte =
  | { id: string; tipo: TipoReporte.GPS; punto: PuntoGeo; precisionMetros: number; fechaReporte: Date }
  | {
      id: string;
      tipo: TipoReporte.Distancia;
      comunidadId: string;
      rumbo: Rumbo;
      distanciaKm: number;
      fechaReporte: Date;
    };

/** Lo que ve quien reporta: estado, riesgo justificado y el contacto comunal autocompletado (HU-1.4). */
export interface VistaReporte {
  id: string;
  tipoReporte: TipoReporte;
  estado: EstadoIncidente;
  nivelRiesgo: NivelRiesgo | null;
  justificacionRiesgo: string | null;
  fechaReporte: Date;
  coordenada: { latitud: number; longitud: number; precisionMetros: number | null };
  rumbo: Rumbo | null;
  distanciaEstimadaKm: number | null;
  comunidad: { id: string; nombre: string } | null;
  contactoComunal: { nombreAutoridad: string; telefono: string; cargo: string } | null;
  tieneEvidencia: boolean;
}

export interface ResultadoReporte {
  reporte: VistaReporte;
  /** true si el UUID ya existía: reintento del cliente offline o SMS repetido, no se duplica (RNF-01). */
  duplicado: boolean;
}

@Injectable()
export class ReporteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly motor: MotorRiesgoService,
    private readonly historial: HistorialEstadoService,
  ) {}

  /** Valida el JSON de la app: GPS (HU-1.1) o avistamiento a distancia (HU-1.2). */
  interpretar(body: unknown): SolicitudReporte {
    const datos = exigirObjeto(body);
    const id = exigirUuid(datos.id, 'id');
    const tipo =
      datos.tipoReporte === undefined ? TipoReporte.GPS : exigirEnum(datos.tipoReporte, 'tipoReporte', Object.values(TipoReporte));
    const fechaReporte = fechaDelCliente(datos.fechaReporte, 'fechaReporte');
    if (tipo === TipoReporte.GPS) {
      const punto = exigirPunto(datos);
      if (datos.precisionMetros === undefined) {
        throw new BadRequestException('precisionMetros es obligatorio para un reporte GPS');
      }
      const precisionMetros = exigirNumero(datos.precisionMetros, 'precisionMetros', 0, PRECISION_MAXIMA_M);
      return { id, tipo, punto, precisionMetros, fechaReporte };
    }
    return {
      id,
      tipo,
      comunidadId: exigirUuid(datos.comunidadId, 'comunidadId'),
      rumbo: exigirEnum(datos.rumbo, 'rumbo', Object.values(Rumbo)),
      distanciaKm: exigirNumero(datos.distanciaKm, 'distanciaKm', 0.1, DISTANCIA_AVISTAMIENTO_MAX_KM),
      fechaReporte,
    };
  }

  /**
   * Registra el foco en "Nuevo" y calcula su riesgo (HU-2.1 parcial). Idempotente por el UUID generado en el
   * dispositivo: el mismo reporte llegado por la app y por SMS, o reintentado, no se duplica (RNF-01).
   */
  async reportar(
    solicitud: SolicitudReporte,
    usuarioId: string | null,
    origen: OrigenReporte = 'App',
  ): Promise<ResultadoReporte> {
    const existente = await this.vista(solicitud.id);
    if (existente) return { reporte: existente, duplicado: true };

    try {
      await this.dataSource.transaction(async (em) => {
        const comunidades = await em.find(Comunidad);
        let punto: PuntoGeo;
        let precisionMetros: number | null = null;
        let referencia = '';
        if (solicitud.tipo === TipoReporte.GPS) {
          punto = solicitud.punto;
          precisionMetros = solicitud.precisionMetros;
        } else {
          const base = comunidades.find((c) => c.id === solicitud.comunidadId);
          if (!base) throw new NotFoundException('Comunidad de referencia no encontrada en el catálogo');
          punto = puntoDestino(base.coordenadas, GRADOS_RUMBO[solicitud.rumbo], solicitud.distanciaKm);
          referencia = ` (avistamiento: ${solicitud.distanciaKm} km al ${solicitud.rumbo} de ${base.nombre})`;
        }
        const evaluacion = this.motor.evaluar(
          punto,
          comunidades.map((c) => ({ id: c.id, nombre: c.nombre, ...c.coordenadas })),
        );
        const incidente = em.create(Incidente, {
          id: solicitud.id,
          tipoReporte: solicitud.tipo,
          estado: EstadoIncidente.Nuevo,
          fechaReporte: solicitud.fechaReporte,
          coordenada: { ...punto, precisionMetros },
          rumbo: solicitud.tipo === TipoReporte.Distancia ? solicitud.rumbo : null,
          distanciaEstimadaKm: solicitud.tipo === TipoReporte.Distancia ? solicitud.distanciaKm : null,
          nivelRiesgo: evaluacion.nivel,
          justificacionRiesgo: evaluacion.justificacion,
          comunidad: evaluacion.comunidadId ? { id: evaluacion.comunidadId } : null,
        });
        await em.insert(Incidente, incidente);
        await this.historial.registrarCambio(
          em,
          incidente,
          null,
          EstadoIncidente.Nuevo,
          `Reporte ${solicitud.tipo === TipoReporte.GPS ? 'GPS' : 'a distancia'} recibido por ${origen}${referencia}. ` +
            `Riesgo ${evaluacion.nivel}: ${evaluacion.justificacion}`,
          usuarioId,
        );
      });
    } catch (error) {
      // Dos reintentos simultáneos del mismo UUID: gana uno, el otro devuelve el ya creado.
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        const creado = await this.vista(solicitud.id);
        if (creado) return { reporte: creado, duplicado: true };
      }
      throw error;
    }
    return { reporte: (await this.vista(solicitud.id))!, duplicado: false };
  }

  async vista(id: string): Promise<VistaReporte | null> {
    const i = await this.dataSource.getRepository(Incidente).findOne({
      where: { id },
      relations: { comunidad: { contacto: true }, evidencia: true },
    });
    if (!i) return null;
    const contacto = i.comunidad?.contacto;
    return {
      id: i.id,
      tipoReporte: i.tipoReporte,
      estado: i.estado,
      nivelRiesgo: i.nivelRiesgo,
      justificacionRiesgo: i.justificacionRiesgo,
      fechaReporte: i.fechaReporte,
      coordenada: {
        latitud: i.coordenada.latitud,
        longitud: i.coordenada.longitud,
        precisionMetros: i.coordenada.precisionMetros,
      },
      rumbo: i.rumbo,
      distanciaEstimadaKm: i.distanciaEstimadaKm,
      comunidad: i.comunidad ? { id: i.comunidad.id, nombre: i.comunidad.nombre } : null,
      contactoComunal:
        contacto && contacto.validarNoVacio()
          ? { nombreAutoridad: contacto.nombreAutoridad, telefono: contacto.telefono, cargo: contacto.cargo }
          : null,
      tieneEvidencia: !!i.evidencia,
    };
  }
}
