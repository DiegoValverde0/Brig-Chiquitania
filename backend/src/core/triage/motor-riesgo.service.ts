import { Injectable } from '@nestjs/common';
import { distanciaKm, PuntoGeo } from '../../common/geo';
import { NivelRiesgo } from './enums/nivel-riesgo.enum';

/** Umbral de la regla única del Bolt 0 (HU-2.1, RF-04). */
export const UMBRAL_ALTO_KM = 5;
export const JUSTIFICACION_ALTO = 'Amenaza directa a vida humana comunitaria';

export interface ComunidadCandidata extends PuntoGeo {
  id: string;
  nombre: string;
}

export interface EvaluacionRiesgo {
  nivel: NivelRiesgo;
  justificacion: string;
  /** Comunidad habitada más cercana (fuente del contacto comunal obligatorio), o null si no hay catálogo. */
  comunidadId: string | null;
  distanciaKm: number | null;
}

/**
 * Motor de riesgo del Bolt 0: una sola regla, "Alto" si hay una comunidad habitada a <5 km; si no, "Bajo".
 * El umbral de "Medio", la exclusión explícita de estancias y la explicabilidad completa llegan en el Bolt 2.
 * Función pura O(n) sobre el catálogo: RNF-04 (<5 s con 50+ focos) se cumple con holgura.
 */
@Injectable()
export class MotorRiesgoService {
  evaluar(foco: PuntoGeo, comunidades: ComunidadCandidata[]): EvaluacionRiesgo {
    let cercana: ComunidadCandidata | null = null;
    let minima = Infinity;
    for (const c of comunidades) {
      const d = distanciaKm(foco, c);
      if (d < minima) {
        minima = d;
        cercana = c;
      }
    }
    if (!cercana) {
      return {
        nivel: NivelRiesgo.Bajo,
        justificacion: 'Sin comunidades habitadas en el catálogo',
        comunidadId: null,
        distanciaKm: null,
      };
    }
    const km = Math.round(minima * 100) / 100;
    if (minima < UMBRAL_ALTO_KM) {
      return {
        nivel: NivelRiesgo.Alto,
        justificacion: `${JUSTIFICACION_ALTO}: ${cercana.nombre} a ${km} km`,
        comunidadId: cercana.id,
        distanciaKm: km,
      };
    }
    return {
      nivel: NivelRiesgo.Bajo,
      justificacion: `Sin comunidad habitada a menos de ${UMBRAL_ALTO_KM} km (más cercana: ${cercana.nombre} a ${km} km)`,
      comunidadId: cercana.id,
      distanciaKm: km,
    };
  }
}
