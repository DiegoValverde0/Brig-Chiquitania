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
