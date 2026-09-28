export enum EstadoOperativo {
  Disponible = 'Disponible',
  En_Ruta = 'En_Ruta',
  En_Operacion = 'En_Operacion',
  /** Operación terminada; pendiente de rendición/liquidación antes de volver a estar Disponible. */
  En_Liquidacion = 'En_Liquidacion',
  Fuera_De_Servicio = 'Fuera_De_Servicio',
}
