import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * Puerto hacia el proveedor de SMS (RNF-02, RF-11). Para conectar un proveedor real (Twilio, módem GSM,
 * operador local) basta con otra implementación de esta clase y registrarla en `crearPasarelaSms`; el resto
 * del sistema no cambia. Los SMS entrantes del proveedor llegan por el webhook `POST /api/sms/entrante`.
 */
export abstract class PasarelaSms {
  /** Identificador del proveedor, se guarda en cada mensaje. */
  abstract readonly nombre: string;

  /** Envía un SMS de un solo segmento; devuelve el id que asigna el proveedor. Lanza si no se pudo enviar. */
  abstract enviar(numero: string, texto: string): Promise<{ idProveedor: string }>;
}

/**
 * Pasarela simulada: no envía nada fuera del sistema. Deja constancia en el log y el mensaje queda en la
 * bandeja (`GET /api/sms/mensajes`) para revisarlo en pruebas. Es la pasarela por defecto mientras no haya
 * proveedor contratado.
 */
export class PasarelaSmsSimulada extends PasarelaSms {
  readonly nombre = 'simulado';
  private readonly log = new Logger('PasarelaSmsSimulada');

  async enviar(numero: string, texto: string): Promise<{ idProveedor: string }> {
    const idProveedor = `sim-${randomUUID()}`;
    this.log.log(`SMS simulado a ${enmascarar(numero)} (${texto.length} car.)`);
    return { idProveedor };
  }
}

/** Elige la pasarela según `SMS_PROVEEDOR`. Un valor desconocido detiene el arranque (falla temprano). */
export function crearPasarelaSms(proveedor: string | undefined): PasarelaSms {
  switch (proveedor ?? 'simulado') {
    case 'simulado':
      return new PasarelaSmsSimulada();
    default:
      throw new Error(`SMS_PROVEEDOR "${proveedor}" no está implementado (disponible: simulado)`);
  }
}

/** Los logs no deben exponer números completos (RNF-08). */
export function enmascarar(numero: string): string {
  return numero.length <= 4 ? '****' : `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`;
}
