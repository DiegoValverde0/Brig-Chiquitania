import { BadRequestException } from '@nestjs/common';
import { distanciaKm } from '../../common/geo';
import { RADIO_REACTIVACION_KM } from '../reporte/reporte.service';
import { EstadoCartaPanel } from '../triage/carta-municipal.service';
import { Candidata } from './elegibilidad';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { OrigenRiesgo } from '../triage/enums/origen-riesgo.enum';

/** Columnas del Kanban del COED (Actividad 3, Figura 9). */
export const COLUMNAS_PANEL = [
  EstadoIncidente.Nuevo,
  EstadoIncidente.Asignado,
  EstadoIncidente.En_Atencion,
  EstadoIncidente.En_Liquidacion,
] as const;

/** Filtro de trámite (CU-08): "con" = carta adjunta que habilita el despacho (por validar o validada). */
export type FiltroCarta = 'con' | 'sin' | 'por_validar';

export interface FiltrosPanel {
  carta: FiltroCarta | null;
  riesgos: NivelRiesgo[] | null;
  comunidad: string | null;
}

export interface TarjetaPanel {
  id: string;
  estado: EstadoIncidente;
  nivelRiesgo: NivelRiesgo | null;
  origenRiesgo: OrigenRiesgo;
  justificacionRiesgo: string | null;
  fechaReporte: Date;
  coordenada: { latitud: number; longitud: number; precisionMetros: number | null };
  comunidad: string | null;
  estadoCarta: EstadoCartaPanel;
  /** Compatibilidad con el Bolt 0: carta adjunta y no rechazada. */
  tieneCartaMunicipal: boolean;
  tieneContactoComunal: boolean;
  brigada: string | null;
  /** Bolt 4: foco controlado que el coordinador reactivó (encabeza su columna). */
  reactivado: boolean;
  /** Bolt 4: foco En Liquidación con un foco Nuevo a menos de 2 km (aviso; decide el coordinador). */
  posibleReactivacion: boolean;
  /** Bolt 4: brigada para el despacho en 1 clic (solo tarjetas "Nuevo"). */
  sugerencia: Candidata | null;
  /** Bolt 4: por qué el botón DESPACHAR está desactivado. */
  bloqueoDespacho: string | null;
  /** Bolt 4: estado del aviso al jefe de brigada (última notificación de la asignación activa). */
  notificacion: ResumenNotificacion | null;
  /** Bolt 5: último % de control de la bitácora (tarjetas En atención / En Liquidación). */
  porcentajeControl: number | null;
}

export interface ResumenNotificacion {
  canal: string;
  estado: string;
  /** El jefe abrió la orden (acuse de recibo) por cualquiera de los canales. */
  leida: boolean;
}

const ORDEN_RIESGO: Record<string, number> = { Alto: 0, Medio: 1, Bajo: 2 };

/** Lee y valida los parámetros de consulta del panel. */
export function leerFiltros(q: Record<string, unknown>): FiltrosPanel {
  const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const carta = texto(q.carta);
  if (carta && !['con', 'sin', 'por_validar'].includes(carta)) {
    throw new BadRequestException('carta debe ser: con, sin o por_validar');
  }
  const riesgo = texto(q.riesgo);
  const riesgos = riesgo ? riesgo.split(',').map((r) => r.trim()) : null;
  if (riesgos && riesgos.some((r) => !(Object.values(NivelRiesgo) as string[]).includes(r))) {
    throw new BadRequestException('riesgo debe ser una lista de: Alto, Medio, Bajo');
  }
  const comunidad = texto(q.comunidad);
  if (comunidad && comunidad.length > 120) throw new BadRequestException('comunidad: máximo 120 caracteres');
  return { carta: carta as FiltroCarta | null, riesgos: riesgos as NivelRiesgo[] | null, comunidad };
}

const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function cumpleFiltros(t: TarjetaPanel, f: FiltrosPanel): boolean {
  if (f.carta === 'con' && !t.tieneCartaMunicipal) return false;
  if (f.carta === 'sin' && t.tieneCartaMunicipal) return false;
  if (f.carta === 'por_validar' && t.estadoCarta !== 'por_validar') return false;
  if (f.riesgos && (!t.nivelRiesgo || !f.riesgos.includes(t.nivelRiesgo))) return false;
  if (f.comunidad && !normalizar(t.comunidad ?? '').includes(normalizar(f.comunidad))) return false;
  return true;
}

/**
 * Más urgente primero: los reactivados (Bolt 4, decisión 7.2: reordenan la prioridad), luego el riesgo y, a igual
 * riesgo, el reporte más antiguo (lleva más tiempo esperando).
 */
export function ordenarTarjetas(a: TarjetaPanel, b: TarjetaPanel): number {
  if (a.reactivado !== b.reactivado) return a.reactivado ? -1 : 1;
  const r = (ORDEN_RIESGO[a.nivelRiesgo ?? ''] ?? 3) - (ORDEN_RIESGO[b.nivelRiesgo ?? ''] ?? 3);
  return r !== 0 ? r : a.fechaReporte.getTime() - b.fechaReporte.getTime();
}

/**
 * Marca los focos En Liquidación con un foco Nuevo reportado después a menos de 2 km: posible reactivación
 * (solo aviso para el coordinador, RS-03; nunca cambia el estado).
 */
export function marcarPosiblesReactivaciones(tarjetas: TarjetaPanel[]): void {
  const nuevos = tarjetas.filter((t) => t.estado === EstadoIncidente.Nuevo);
  for (const t of tarjetas) {
    t.posibleReactivacion =
      t.estado === EstadoIncidente.En_Liquidacion &&
      nuevos.some(
        (n) =>
          n.fechaReporte.getTime() > t.fechaReporte.getTime() &&
          distanciaKm(n.coordenada, t.coordenada) < RADIO_REACTIVACION_KM,
      );
  }
}

/** Agrupa en columnas y calcula los contadores (total y con carta) de lo que queda tras el filtro. */
export function armarColumnas(tarjetas: TarjetaPanel[], filtros: FiltrosPanel) {
  const visibles = tarjetas.filter((t) => cumpleFiltros(t, filtros)).sort(ordenarTarjetas);
  const incidentes = Object.fromEntries(COLUMNAS_PANEL.map((c) => [c, [] as TarjetaPanel[]])) as Record<
    (typeof COLUMNAS_PANEL)[number],
    TarjetaPanel[]
  >;
  for (const t of visibles) {
    if (t.estado in incidentes) incidentes[t.estado as (typeof COLUMNAS_PANEL)[number]].push(t);
  }
  const columnas = Object.fromEntries(
    COLUMNAS_PANEL.map((c) => [c, { total: incidentes[c].length, conCarta: incidentes[c].filter((t) => t.tieneCartaMunicipal).length }]),
  );
  return { incidentes, columnas, total: tarjetas.length, visibles: visibles.length };
}
