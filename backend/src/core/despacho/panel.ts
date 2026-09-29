import { BadRequestException } from '@nestjs/common';
import { EstadoCartaPanel } from '../triage/carta-municipal.service';
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

/** Más urgente primero: riesgo y, a igual riesgo, el reporte más antiguo (lleva más tiempo esperando). */
export function ordenarTarjetas(a: TarjetaPanel, b: TarjetaPanel): number {
  const r = (ORDEN_RIESGO[a.nivelRiesgo ?? ''] ?? 3) - (ORDEN_RIESGO[b.nivelRiesgo ?? ''] ?? 3);
  return r !== 0 ? r : a.fechaReporte.getTime() - b.fechaReporte.getTime();
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
