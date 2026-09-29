/** Tipo de entrada del historial append-only (RNF-07). */
export enum TipoEventoHistorial {
  /** Transición del ciclo de vida del incidente (Nuevo → Asignado → …). */
  CambioEstado = 'CambioEstado',
  /** Reclasificación manual del riesgo (HU-2.2): el estado no cambia, cambia el nivel. */
  Reclasificacion = 'Reclasificacion',
  /** Bolt 4: foco controlado (En Liquidación) que vuelve a Nuevo por decisión del coordinador. */
  Reactivacion = 'Reactivacion',
}
