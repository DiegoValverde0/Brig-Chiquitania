/** Punto mínimo para cálculos de distancia (compatible con la Coordenada embebida). */
export interface PuntoGeo {
  latitud: number;
  longitud: number;
}

const RADIO_TIERRA_KM = 6371;

/**
 * Distancia en km entre dos puntos WGS84 (haversine). Cumple la "distancia euclidiana" de la SRS sobre la
 * esfera terrestre, con costo despreciable y sin PostGIS [inferencia aprobada por el PO].
 */
export function distanciaKm(a: PuntoGeo, b: PuntoGeo): number {
  const rad = (g: number): number => (g * Math.PI) / 180;
  const dLat = rad(b.latitud - a.latitud);
  const dLon = rad(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitud)) * Math.cos(rad(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Punto destino a `km` de `origen` siguiendo el rumbo `grados` (0 = N, 90 = E), sobre la esfera.
 * Lo usa el reporte a distancia (HU-1.2) para ubicar el foco a partir de la comunidad, el rumbo y la distancia.
 */
export function puntoDestino(origen: PuntoGeo, grados: number, km: number): PuntoGeo {
  const rad = (g: number): number => (g * Math.PI) / 180;
  const deg = (r: number): number => (r * 180) / Math.PI;
  const d = km / RADIO_TIERRA_KM;
  const rumbo = rad(grados);
  const lat1 = rad(origen.latitud);
  const lon1 = rad(origen.longitud);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(rumbo));
  const lon2 =
    lon1 + Math.atan2(Math.sin(rumbo) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  const redondear = (g: number): number => Math.round(g * 1e6) / 1e6;
  return { latitud: redondear(deg(lat2)), longitud: redondear(((deg(lon2) + 540) % 360) - 180) };
}
