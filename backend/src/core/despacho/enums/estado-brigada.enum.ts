/** Los 4 estados de brigada del UML / RF-08. */
export enum EstadoBrigada {
  Disponible = 'Disponible',
  En_Desplazamiento = 'En_Desplazamiento',
  En_Combate_Activo = 'En_Combate_Activo',
  /** Operación por finalizar: candidata a reasignación táctica a <30 km de un foco crítico (Bolt 4). */
  En_Liquidacion = 'En_Liquidacion',
}
