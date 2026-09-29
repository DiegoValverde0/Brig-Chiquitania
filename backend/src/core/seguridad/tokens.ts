import { createHash, randomBytes } from 'node:crypto';

/** Token de acceso aleatorio (192 bits), apto para URL y para escribirlo a mano si hace falta. */
export function generarToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
