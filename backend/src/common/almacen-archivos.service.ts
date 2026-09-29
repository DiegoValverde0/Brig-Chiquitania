import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cifrarBytes, descifrarBytes } from './cifrado';

/** Tipos de archivo que acepta el sistema, detectados por su firma de bytes (no por el Content-Type). */
export type TipoArchivo = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

export const TIPOS_IMAGEN: TipoArchivo[] = ['image/jpeg', 'image/png', 'image/webp'];
export const TIPOS_DOCUMENTO: TipoArchivo[] = [...TIPOS_IMAGEN, 'application/pdf'];

/** Tipo real por "números mágicos": no se confía en el Content-Type declarado. */
export function detectarTipo(b: Buffer): TipoArchivo | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function sha256De(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

/**
 * Almacén de archivos cifrados en disco (RNF-08): fotos de los reportes (Bolt 1) y cartas municipales (Bolt 3).
 * Escritura atómica (temporal + rename) y nombre con el hash, para que dos envíos simultáneos nunca se pisen.
 * Solo guarda bytes: la validación de tamaño y tipo, y los metadatos en BD, son de cada servicio.
 */
@Injectable()
export class AlmacenArchivosService {
  private readonly directorio: string;

  constructor(config: ConfigService) {
    this.directorio = resolve(config.get<string>('EVIDENCIAS_DIR', 'almacen/evidencias'));
  }

  /** Guarda `datos` cifrados y devuelve la ruta relativa (UML: urlArchivo / archivoDigital). */
  async guardar(prefijo: string, datos: Buffer, sha256: string): Promise<string> {
    const ruta = `${prefijo}-${sha256.slice(0, 16)}.bin`;
    const destino = join(this.directorio, ruta);
    await mkdir(this.directorio, { recursive: true });
    const temporal = `${destino}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporal, cifrarBytes(datos), { mode: 0o600 });
    await rename(temporal, destino);
    return ruta;
  }

  async leer(ruta: string): Promise<Buffer> {
    return descifrarBytes(await readFile(this.rutaSegura(ruta)));
  }

  async borrar(ruta: string): Promise<void> {
    await rm(this.rutaSegura(ruta), { force: true });
  }

  /** Las rutas vienen de la BD, pero igual se impide salir del directorio del almacén. */
  private rutaSegura(ruta: string): string {
    if (!/^[\w.-]+$/.test(ruta)) throw new Error('Ruta de archivo inválida');
    return join(this.directorio, ruta);
  }
}
