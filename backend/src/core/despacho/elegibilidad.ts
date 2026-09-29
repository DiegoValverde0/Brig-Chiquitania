import { distanciaKm, PuntoGeo } from '../../common/geo';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { EstadoBrigada } from './enums/estado-brigada.enum';

/** HU-4.3 / Acta ACTA-002 (acuerdo 4): radio de la reasignación táctica de una brigada "En Liquidación". */
export const RADIO_REASIGNACION_KM = 30;
/** CU-04: solo focos Alto/Medio justifican el despacho departamental. */
export const RIESGOS_DESPACHABLES: NivelRiesgo[] = [NivelRiesgo.Alto, NivelRiesgo.Medio];

export type TipoCandidata = 'disponible' | 'reasignacion';

/**
 * Regla de elegibilidad (función pura). Una brigada "Disponible" siempre es candidata; una "En Liquidación" solo
 * para un foco crítico (Alto) a menos de 30 km (reasignación táctica). Las demás, no.
 */
export function elegibilidad(
  estado: EstadoBrigada,
  nivelRiesgo: NivelRiesgo | null,
  distancia: number,
): TipoCandidata | null {
  if (estado === EstadoBrigada.Disponible) return 'disponible';
  if (estado === EstadoBrigada.En_Liquidacion && nivelRiesgo === NivelRiesgo.Alto && distancia < RADIO_REASIGNACION_KM) {
    return 'reasignacion';
  }
  return null;
}

export interface BrigadaParaDespacho {
  id: string;
  nombre: string;
  estadoOperativo: EstadoBrigada;
  ubicacion: PuntoGeo;
  version: number;
  jefeConTelefono: boolean;
  /** Foco que deja al reasignarse (el que estaba liquidando), si lo tiene. */
  incidente: { id: string; comunidad: string | null } | null;
}

export interface Candidata {
  id: string;
  nombre: string;
  estadoOperativo: EstadoBrigada;
  version: number;
  distanciaKm: number;
  reasignacion: boolean;
  jefeConTelefono: boolean;
  /** Se puede despachar ya: elegible y con jefe con teléfono (decisión 7.4 del PO). */
  despachable: boolean;
  focoAnterior: { id: string; comunidad: string | null } | null;
}

/** Candidatas ordenadas: primero las reasignaciones tácticas (Acta: evitar enviar desde la capital), luego por cercanía. */
export function candidatas(
  foco: { coordenada: PuntoGeo; nivelRiesgo: NivelRiesgo | null },
  brigadas: BrigadaParaDespacho[],
): Candidata[] {
  const lista: Candidata[] = [];
  for (const b of brigadas) {
    const d = Math.round(distanciaKm(foco.coordenada, b.ubicacion) * 100) / 100;
    const tipo = elegibilidad(b.estadoOperativo, foco.nivelRiesgo, d);
    if (!tipo) continue;
    lista.push({
      id: b.id,
      nombre: b.nombre,
      estadoOperativo: b.estadoOperativo,
      version: b.version,
      distanciaKm: d,
      reasignacion: tipo === 'reasignacion',
      jefeConTelefono: b.jefeConTelefono,
      despachable: b.jefeConTelefono,
      focoAnterior: tipo === 'reasignacion' ? b.incidente : null,
    });
  }
  return lista.sort((a, b) => Number(b.reasignacion) - Number(a.reasignacion) || a.distanciaKm - b.distanciaKm);
}

export interface DespachoDeTarjeta {
  sugerencia: Candidata | null;
  /** Por qué no se puede despachar todavía (el botón DESPACHAR se muestra desactivado con este motivo). */
  bloqueo: string | null;
}

/** Botón DESPACHAR de una tarjeta "Nuevo": la mejor brigada despachable o el motivo del bloqueo (mismas guardas que la API). */
export function despachoDeTarjeta(
  foco: {
    coordenada: PuntoGeo;
    nivelRiesgo: NivelRiesgo | null;
    tieneCartaMunicipal: boolean;
    tieneContactoComunal: boolean;
  },
  brigadas: BrigadaParaDespacho[],
): DespachoDeTarjeta {
  if (!foco.nivelRiesgo || !RIESGOS_DESPACHABLES.includes(foco.nivelRiesgo)) {
    return { sugerencia: null, bloqueo: 'Riesgo Bajo: no justifica despacho departamental' };
  }
  if (!foco.tieneCartaMunicipal) return { sugerencia: null, bloqueo: 'Falta la carta municipal (Ley 602)' };
  if (!foco.tieneContactoComunal) return { sugerencia: null, bloqueo: 'Falta el contacto comunal' };
  const lista = candidatas(foco, brigadas);
  const despachable = lista.find((c) => c.despachable);
  if (despachable) return { sugerencia: despachable, bloqueo: null };
  if (lista.length) return { sugerencia: null, bloqueo: `${lista[0].nombre} no tiene jefe con teléfono registrado` };
  return { sugerencia: null, bloqueo: 'Sin brigada disponible' };
}
