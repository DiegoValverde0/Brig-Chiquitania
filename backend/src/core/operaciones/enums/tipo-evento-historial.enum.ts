/** Tipo de entrada del historial append-only (RNF-07). */
export enum TipoEventoHistorial {
  /** Transición del ciclo de vida del incidente (Nuevo → Asignado → …). */
  CambioEstado = 'CambioEstado',
  /** Reclasificación manual del riesgo (HU-2.2): el estado no cambia, cambia el nivel. */
  Reclasificacion = 'Reclasificacion',
}
