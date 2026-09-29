import { Injectable } from '@nestjs/common';
import { distanciaKm, PuntoGeo } from '../../common/geo';
import { NivelRiesgo } from './enums/nivel-riesgo.enum';

/** HU-2.1 / RF-04: comunidad habitada a menos de 5 km ⇒ Alto (umbral de la SRS). */
export const UMBRAL_ALTO_KM = 5;
/** Franja "Medio": comunidad habitada entre 5 y 15 km [inferencia aprobada por el PO el 29/09/2026]. */
export const UMBRAL_MEDIO_KM = 15;
/** Texto exacto exigido por la SRS (HU-2.1) y por la DoD del Bolt 2 para todo foco Alto. */
export const JUSTIFICACION_ALTO = 'Amenaza directa a vida humana comunitaria';
export const VERSION_MOTOR = 'motor-v2';
/** Cuántos predios excluidos se listan como máximo en la explicación (los más cercanos). */
const MAX_PREDIOS_EN_EXPLICACION = 3;

export interface ComunidadCandidata extends PuntoGeo {
  id: string;
  nombre: string;
}

export interface PredioCandidato extends PuntoGeo {
  nombre: string;
  tipo: string;
}

export type ReglaRiesgo = 'ComunidadAMenosDe5Km' | 'ComunidadEntre5y15Km' | 'SinComunidadCercana' | 'CatalogoVacio';

/**
 * Factores evaluados, guardados con el incidente (RF-05: explicabilidad algorítmica). Permiten reconstruir
 * por qué el motor asignó el nivel, con qué versión de las reglas y qué quedó excluido.
 */
export interface FactoresRiesgo {
  version: string;
  regla: ReglaRiesgo;
  umbrales: { altoKm: number; medioKm: number };
  comunidadMasCercana: { id: string; nombre: string; distanciaKm: number } | null;
  /** Estancias o predios privados dentro de la franja evaluada: nunca elevan la prioridad (RS-03, Ley 300). */
  prediosExcluidos: Array<{ nombre: string; tipo: string; distanciaKm: number }>;
  duracionMs: number;
}

export interface EvaluacionRiesgo {
  nivel: NivelRiesgo;
  justificacion: string;
  /** Comunidad habitada más cercana (fuente del contacto comunal obligatorio), o null si no hay catálogo. */
  comunidadId: string | null;
  distanciaKm: number | null;
  factores: FactoresRiesgo;
}

const redondear = (km: number): number => Math.round(km * 100) / 100;

/**
 * Motor de riesgo (M2, CU-05). Función pura y O(n) sobre los catálogos (RNF-04: <5 s con 50+ focos).
 *
 * Reglas, sobre la comunidad habitada más cercana:
 *   < 5 km        ⇒ Alto  ("Amenaza directa a vida humana comunitaria")
 *   5 a < 15 km   ⇒ Medio
 *   ≥ 15 km       ⇒ Bajo
 * Los predios privados (estancias) se evalúan solo para dejar constancia de su exclusión: nunca suben el nivel.
 * El motor no despacha nada: solo clasifica y explica; la decisión es siempre humana (RS-03).
 */
@Injectable()
export class MotorRiesgoService {
  evaluar(foco: PuntoGeo, comunidades: ComunidadCandidata[], predios: PredioCandidato[] = []): EvaluacionRiesgo {
    const inicio = performance.now();

    let cercana: ComunidadCandidata | null = null;
    let minima = Infinity;
    for (const c of comunidades) {
      const d = distanciaKm(foco, c);
      if (d < minima) {
        minima = d;
        cercana = c;
      }
    }

    const prediosExcluidos = predios
      .map((p) => ({ nombre: p.nombre, tipo: p.tipo, distanciaKm: redondear(distanciaKm(foco, p)) }))
      .filter((p) => p.distanciaKm < UMBRAL_MEDIO_KM)
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, MAX_PREDIOS_EN_EXPLICACION);

    const km = cercana ? redondear(minima) : null;
    let nivel: NivelRiesgo;
    let regla: ReglaRiesgo;
    let texto: string;
    if (!cercana || km === null) {
      nivel = NivelRiesgo.Bajo;
      regla = 'CatalogoVacio';
      texto = 'Sin comunidades habitadas en el catálogo';
    } else if (minima < UMBRAL_ALTO_KM) {
      nivel = NivelRiesgo.Alto;
      regla = 'ComunidadAMenosDe5Km';
      texto = `${JUSTIFICACION_ALTO}: ${cercana.nombre} a ${km} km`;
    } else if (minima < UMBRAL_MEDIO_KM) {
      nivel = NivelRiesgo.Medio;
      regla = 'ComunidadEntre5y15Km';
      texto = `Comunidad habitada en el área de influencia: ${cercana.nombre} a ${km} km`;
    } else {
      nivel = NivelRiesgo.Bajo;
      regla = 'SinComunidadCercana';
      texto = `Sin comunidad habitada a menos de ${UMBRAL_MEDIO_KM} km (más cercana: ${cercana.nombre} a ${km} km)`;
    }

    if (prediosExcluidos.length) {
      const lista = prediosExcluidos.map((p) => `${p.tipo} ${p.nombre} a ${p.distanciaKm} km`).join(', ');
      texto += `. Excluido de la priorización automática: ${lista}`;
    }

    return {
      nivel,
      justificacion: texto,
      comunidadId: cercana?.id ?? null,
      distanciaKm: km,
      factores: {
        version: VERSION_MOTOR,
        regla,
        umbrales: { altoKm: UMBRAL_ALTO_KM, medioKm: UMBRAL_MEDIO_KM },
        comunidadMasCercana: cercana && km !== null ? { id: cercana.id, nombre: cercana.nombre, distanciaKm: km } : null,
        prediosExcluidos,
        duracionMs: Math.round((performance.now() - inicio) * 1000) / 1000,
      },
    };
  }
}
