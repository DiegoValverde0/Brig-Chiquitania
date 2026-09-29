/**
 * Eventos auditados fuera del ciclo de vida del incidente: trámite municipal y estados tácticos (Bolt 3);
 * reasignación táctica, jefe de brigada y notificaciones (Bolt 4).
 */
export enum TipoEventoAuditoria {
  CartaAdjuntada = 'CartaAdjuntada',
  CartaReemplazada = 'CartaReemplazada',
  CartaValidada = 'CartaValidada',
  CartaRechazada = 'CartaRechazada',
  BrigadaEstadoTactico = 'BrigadaEstadoTactico',
  ReasignacionTactica = 'ReasignacionTactica',
  BrigadaJefe = 'BrigadaJefe',
  NotificacionEnviada = 'NotificacionEnviada',
  NotificacionFallida = 'NotificacionFallida',
}
