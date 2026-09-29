import { BadRequestException } from '@nestjs/common';
import { PuntoGeo } from './geo';

/**
 * Validación manual y liviana de los payloads (sin class-validator: cada dependencia de runtime cuenta
 * frente al límite de memoria del VPS).
 */
export function exigirObjeto(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Se esperaba un objeto JSON');
  }
  return body as Record<string, unknown>;
}

export function exigirNumero(valor: unknown, campo: string, min: number, max: number): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < min || valor > max) {
    throw new BadRequestException(`${campo} debe ser un número entre ${min} y ${max}`);
  }
  return valor;
}

export function exigirTexto(valor: unknown, campo: string, maxLargo: number): string {
  if (typeof valor !== 'string' || valor.trim().length === 0 || valor.length > maxLargo) {
    throw new BadRequestException(`${campo} es obligatorio (máx. ${maxLargo} caracteres)`);
  }
  return valor.trim();
}

/** Teléfono boliviano o internacional: dígitos con "+" opcional, 7 a 15 dígitos (E.164). */
const TELEFONO = /^\+?[0-9]{7,15}$/;

export function exigirTelefono(valor: unknown, campo = 'telefono'): string {
  const limpio = typeof valor === 'string' ? valor.replace(/[\s-]/g, '') : '';
  if (!TELEFONO.test(limpio)) {
    throw new BadRequestException(`${campo} debe tener entre 7 y 15 dígitos (se admite "+" inicial)`);
  }
  return limpio;
}

export function exigirEnum<T extends string>(valor: unknown, campo: string, valores: readonly T[]): T {
  if (typeof valor !== 'string' || !valores.includes(valor as T)) {
    throw new BadRequestException(`${campo} debe ser uno de: ${valores.join(', ')}`);
  }
  return valor as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exigirUuid(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new BadRequestException(`${campo} debe ser un UUID`);
  }
  return valor.toLowerCase();
}

export function exigirPunto(body: Record<string, unknown>): PuntoGeo {
  return {
    latitud: exigirNumero(body.latitud, 'latitud', -90, 90),
    longitud: exigirNumero(body.longitud, 'longitud', -180, 180),
  };
}

/** Tolerancia al desfase de reloj de los dispositivos de campo [inferencia]. */
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/**
 * Fecha capturada en el dispositivo (offline-first: el reporte o la llegada pueden sincronizarse tarde).
 * Opcional; si falta se usa la hora del servidor. Nunca en el futuro.
 */
export function fechaDelCliente(valor: unknown, campo: string, ahora = new Date()): Date {
  if (valor === undefined || valor === null) return ahora;
  const fecha = typeof valor === 'string' ? new Date(valor) : new Date(NaN);
  if (Number.isNaN(fecha.getTime())) {
    throw new BadRequestException(`${campo} debe ser una fecha ISO 8601`);
  }
  if (fecha.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
    throw new BadRequestException(`${campo} no puede estar en el futuro`);
  }
  return fecha;
}
