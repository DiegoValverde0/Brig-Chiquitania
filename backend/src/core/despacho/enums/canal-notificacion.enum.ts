/** UML `EnumCanal` (Bolt 4, RF-11): primero Web Push; sin cobertura, SMS. */
export enum CanalNotificacion {
  WebPush = 'WebPush',
  SMS = 'SMS',
}

/** UML `Notificacion.estadoEnvio` [valores: inferencia]. `Leida` = el jefe abrió la orden (acuse de recibo). */
export enum EstadoEnvio {
  Pendiente = 'Pendiente',
  Enviada = 'Enviada',
  Fallida = 'Fallida',
  Leida = 'Leida',
}
