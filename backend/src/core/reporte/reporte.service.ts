import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { exigirNumero, exigirObjeto, exigirPunto, exigirUuid, fechaDelCliente } from '../../common/validacion';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { MotorRiesgoService } from '../triage/motor-riesgo.service';
import { Comunidad } from './entities/comunidad.entity';
import { TipoReporte } from './enums/tipo-reporte.enum';

/** Precisión máxima aceptada para un GPS nativo (RF-01). */
export const PRECISION_MAXIMA_M = 15;

export interface ResultadoReporte {
  incidente: Incidente;
  /** true si el UUID ya existía: reintento del cliente offline, no se duplica (RNF-01). */
  duplicado: boolean;
}

@Injectable()
export class ReporteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly motor: MotorRiesgoService,
    private readonly historial: HistorialEstadoService,
  ) {}

  /** HU-1.1 (parcial) + HU-2.1 (parcial): registra el foco GPS en "Nuevo" y calcula su riesgo. */
  async reportarGps(body: unknown): Promise<ResultadoReporte> {
    const datos = exigirObjeto(body);
    const id = exigirUuid(datos.id, 'id');
    const punto = exigirPunto(datos);
    if (datos.precisionMetros === undefined) {
      throw new BadRequestException('precisionMetros es obligatorio para un reporte GPS');
    }
    const precisionMetros = exigirNumero(datos.precisionMetros, 'precisionMetros', 0, PRECISION_MAXIMA_M);
    const fechaReporte = fechaDelCliente(datos.fechaReporte, 'fechaReporte');

    const existente = await this.buscar(id);
    if (existente) return { incidente: existente, duplicado: true };

    try {
      await this.dataSource.transaction(async (em) => {
        const comunidades = await em.find(Comunidad);
        const evaluacion = this.motor.evaluar(
          punto,
          comunidades.map((c) => ({ id: c.id, nombre: c.nombre, ...c.coordenadas })),
        );
        const incidente = em.create(Incidente, {
          id,
          tipoReporte: TipoReporte.GPS,
          estado: EstadoIncidente.Nuevo,
          fechaReporte,
          coordenada: { ...punto, precisionMetros },
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
          `Reporte GPS recibido. Riesgo ${evaluacion.nivel}: ${evaluacion.justificacion}`,
        );
      });
    } catch (error) {
      // Dos reintentos simultáneos del mismo UUID: gana uno, el otro devuelve el ya creado.
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        const creado = await this.buscar(id);
        if (creado) return { incidente: creado, duplicado: true };
      }
      throw error;
    }
    return { incidente: (await this.buscar(id))!, duplicado: false };
  }

  private buscar(id: string): Promise<Incidente | null> {
    return this.dataSource.getRepository(Incidente).findOne({ where: { id }, relations: { comunidad: true } });
  }
}
