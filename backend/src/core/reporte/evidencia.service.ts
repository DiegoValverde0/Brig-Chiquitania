import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { cifrarBytes, descifrarBytes } from '../../common/cifrado';
import { fechaDelCliente } from '../../common/validacion';
import { Incidente } from '../triage/entities/incidente.entity';
import { EvidenciaFotografica } from './entities/evidencia-fotografica.entity';

/** RF-03: fotografía ultracomprimida de hasta 100 KB. */
export const PESO_MAXIMO_BYTES = 100 * 1024;
export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'];

export interface ResultadoEvidencia {
  evidencia: EvidenciaFotografica;
  /** true si la misma foto ya estaba guardada (reintento offline). */
  duplicada: boolean;
}

@Injectable()
export class EvidenciaService {
  private readonly directorio: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.directorio = resolve(config.get<string>('EVIDENCIAS_DIR', 'almacen/evidencias'));
  }

  /** HU-1.1: adjunta la foto (0..1 por incidente), cifrada en disco (RNF-08). */
  async guardar(incidenteId: string, cuerpo: unknown, capturadaEn: unknown): Promise<ResultadoEvidencia> {
    if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
      throw new UnsupportedMediaTypeException(`Envíe la imagen como cuerpo binario (${TIPOS_IMAGEN.join(', ')})`);
    }
    if (cuerpo.length > PESO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException('La fotografía supera los 100 KB (RF-03): comprímala antes de enviarla');
    }
    const tipoMime = detectarTipo(cuerpo);
    if (!tipoMime) throw new UnsupportedMediaTypeException('El archivo no es una imagen JPEG, PNG o WebP válida');
    const timestamp = fechaDelCliente(capturadaEn, 'x-capturada-en');
    const sha256 = createHash('sha256').update(cuerpo).digest('hex');

    const incidente = await this.dataSource.getRepository(Incidente).findOne({
      where: { id: incidenteId },
      relations: { evidencia: true },
    });
    if (!incidente) throw new NotFoundException('Incidente no encontrado');
    if (incidente.evidencia) {
      if (incidente.evidencia.sha256 === sha256) return { evidencia: incidente.evidencia, duplicada: true };
      throw new ConflictException('El incidente ya tiene una fotografía (0..1)');
    }

    // El nombre incluye el hash: dos envíos simultáneos de fotos distintas nunca se pisan el archivo.
    const urlArchivo = `${incidenteId}-${sha256.slice(0, 16)}.bin`;
    const ruta = join(this.directorio, urlArchivo);
    await mkdir(this.directorio, { recursive: true });
    // Escritura atómica: primero a un temporal y luego rename, para no dejar archivos a medias.
    const temporal = `${ruta}.${process.pid}.tmp`;
    await writeFile(temporal, cifrarBytes(cuerpo), { mode: 0o600 });
    await rename(temporal, ruta);

    try {
      const evidencia = this.dataSource.getRepository(EvidenciaFotografica).create({
        urlArchivo,
        pesoKB: Math.round((cuerpo.length / 1024) * 10) / 10,
        timestamp,
        tipoMime,
        sha256,
        incidente: { id: incidenteId },
      });
      await this.dataSource.getRepository(EvidenciaFotografica).insert(evidencia);
      return { evidencia: await this.dataSource.getRepository(EvidenciaFotografica).findOneByOrFail({ id: evidencia.id }), duplicada: false };
    } catch (error) {
      // Carrera con otro envío simultáneo: la restricción única (0..1) decide quién gana.
      const otra = await this.dataSource
        .getRepository(EvidenciaFotografica)
        .findOneBy({ incidente: { id: incidenteId } });
      if (otra?.sha256 === sha256) return { evidencia: otra, duplicada: true };
      await rm(ruta, { force: true }); // nuestro archivo quedó huérfano
      if (otra) throw new ConflictException('El incidente ya tiene una fotografía (0..1)');
      throw error;
    }
  }

  /** Devuelve la foto descifrada (solo coordinador). */
  async leer(incidenteId: string): Promise<{ datos: Buffer; tipoMime: string }> {
    const evidencia = await this.dataSource
      .getRepository(EvidenciaFotografica)
      .findOneBy({ incidente: { id: incidenteId } });
    if (!evidencia) throw new NotFoundException('El incidente no tiene fotografía');
    const sobre = await readFile(join(this.directorio, evidencia.urlArchivo));
    return { datos: descifrarBytes(sobre), tipoMime: evidencia.tipoMime };
  }
}

/** Tipo real por "números mágicos": no se confía en el Content-Type declarado. */
export function detectarTipo(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
