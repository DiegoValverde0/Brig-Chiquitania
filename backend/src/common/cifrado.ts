import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ValueTransformer } from 'typeorm';

/**
 * RNF-08 (Ley N.º 164): cifrado en reposo con AES-256-GCM (confidencialidad + integridad), sin dependencias
 * externas. Formato de texto: `v1:<iv>:<tag>:<cifrado>` en base64url, versionado para rotar la clave o el
 * algoritmo más adelante.
 *
 * La clave llega en `CLAVE_CIFRADO` (32 bytes en base64). En producción es obligatoria; en desarrollo y
 * pruebas se usa una clave fija y pública de ejemplo para que el entorno arranque sin configuración.
 */
const VERSION = 'v1';
const CLAVE_DESARROLLO = createHash('sha256').update('brig-chiquitania-solo-desarrollo').digest();

let claveCache: Buffer | null = null;

export function claveCifrado(): Buffer {
  if (claveCache) return claveCache;
  const valor = process.env.CLAVE_CIFRADO;
  if (!valor) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CLAVE_CIFRADO es obligatoria en producción (32 bytes en base64)');
    }
    claveCache = CLAVE_DESARROLLO;
    return claveCache;
  }
  const clave = Buffer.from(valor, 'base64');
  if (clave.length !== 32) throw new Error('CLAVE_CIFRADO debe decodificar a 32 bytes (AES-256)');
  claveCache = clave;
  return claveCache;
}

/** Solo para pruebas: olvida la clave cacheada (p. ej. tras cambiar CLAVE_CIFRADO). */
export function reiniciarClaveCifrado(): void {
  claveCache = null;
}

export function cifrarBytes(datos: Buffer): Buffer {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const cuerpo = Buffer.concat([cifrador.update(datos), cifrador.final()]);
  // iv (12) | tag (16) | cuerpo
  return Buffer.concat([iv, cifrador.getAuthTag(), cuerpo]);
}

export function descifrarBytes(sobre: Buffer): Buffer {
  if (sobre.length < 28) throw new Error('Sobre cifrado inválido');
  const descifrador = createDecipheriv('aes-256-gcm', claveCifrado(), sobre.subarray(0, 12));
  descifrador.setAuthTag(sobre.subarray(12, 28));
  return Buffer.concat([descifrador.update(sobre.subarray(28)), descifrador.final()]);
}

export function cifrarTexto(texto: string): string {
  const sobre = cifrarBytes(Buffer.from(texto, 'utf8'));
  const b = (x: Buffer): string => x.toString('base64url');
  return [VERSION, b(sobre.subarray(0, 12)), b(sobre.subarray(12, 28)), b(sobre.subarray(28))].join(':');
}

export function descifrarTexto(valor: string): string {
  const partes = valor.split(':');
  if (partes.length !== 4 || partes[0] !== VERSION) throw new Error('Valor cifrado con formato desconocido');
  const [, iv, tag, cuerpo] = partes.map((p) => Buffer.from(p, 'base64url'));
  return descifrarBytes(Buffer.concat([iv, tag, cuerpo])).toString('utf8');
}

export function esTextoCifrado(valor: unknown): boolean {
  return typeof valor === 'string' && valor.startsWith(`${VERSION}:`);
}

/** Transformer de TypeORM para columnas `text` con un string cifrado. */
export const textoCifrado: ValueTransformer = {
  to: (valor: string | null | undefined) => (valor === null || valor === undefined ? valor : cifrarTexto(valor)),
  from: (valor: string | null) => (valor === null ? null : descifrarTexto(valor)),
};

/** Transformer de TypeORM para columnas `text` que guardan un número cifrado (p. ej. la ubicación del foco). */
export const numeroCifrado: ValueTransformer = {
  to: (valor: number | null | undefined) =>
    valor === null || valor === undefined ? valor : cifrarTexto(String(valor)),
  from: (valor: string | null) => (valor === null ? null : Number(descifrarTexto(valor))),
};
