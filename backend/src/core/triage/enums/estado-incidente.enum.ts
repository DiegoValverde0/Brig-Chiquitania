/** Ciclo de vida del incidente (SRS §2.2 / UML): Nuevo → Asignado → En atención → En Liquidación → Cerrado. */
export enum EstadoIncidente {
  Nuevo = 'Nuevo',
  Asignado = 'Asignado',
  En_Atencion = 'En_Atencion',
  En_Liquidacion = 'En_Liquidacion',
  Cerrado = 'Cerrado',
}
