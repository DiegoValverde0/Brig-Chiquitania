import {
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AlmacenArchivosService, detectarTipo, sha256De, TIPOS_IMAGEN } from '../../common/almacen-archivos.service';
import { fechaDelCliente } from '../../common/validacion';
import { Incidente } from '../triage/entities/incidente.entity';
import { EvidenciaFotografica } from './entities/evidencia-fotografica.entity';

/** RF-03: fotografía ultracomprimida de hasta 100 KB. */
export const PESO_MAXIMO_BYTES = 100 * 1024;

export interface ResultadoEvidencia {
  evidencia: EvidenciaFotografica;
  /** true si la misma foto ya estaba guardada (reintento offline). */
  duplicada: boolean;
}

@Injectable()
export class EvidenciaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly almacen: AlmacenArchivosService,
  ) {}

  /** HU-1.1: adjunta la foto (0..1 por incidente), cifrada en disco (RNF-08). */
  async guardar(incidenteId: string, cuerpo: unknown, capturadaEn: unknown): Promise<ResultadoEvidencia> {
    if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
      throw new UnsupportedMediaTypeException(`Envíe la imagen como cuerpo binario (${TIPOS_IMAGEN.join(', ')})`);
    }
    if (cuerpo.length > PESO_MAXIMO_BYTES) {
      throw new PayloadTooLargeException('La fotografía supera los 100 KB (RF-03): comprímala antes de enviarla');
    }
    const tipoMime = detectarTipo(cuerpo);
    if (!tipoMime || !TIPOS_IMAGEN.includes(tipoMime)) {
      throw new UnsupportedMediaTypeException('El archivo no es una imagen JPEG, PNG o WebP válida');
    }
    const timestamp = fechaDelCliente(capturadaEn, 'x-capturada-en');
    const sha256 = sha256De(cuerpo);

    const incidente = await this.dataSource.getRepository(Incidente).findOne({
      where: { id: incidenteId },
      relations: { evidencia: true },
    });
    if (!incidente) throw new NotFoundException('Incidente no encontrado');
    if (incidente.evidencia) {
      if (incidente.evidencia.sha256 === sha256) return { evidencia: incidente.evidencia, duplicada: true };
      throw new ConflictException('El incidente ya tiene una fotografía (0..1)');
    }

    const urlArchivo = await this.almacen.guardar(incidenteId, cuerpo, sha256);
    const repo = this.dataSource.getRepository(EvidenciaFotografica);
    try {
      const evidencia = repo.create({
        urlArchivo,
        pesoKB: Math.round((cuerpo.length / 1024) * 10) / 10,
        timestamp,
        tipoMime,
        sha256,
        incidente: { id: incidenteId },
      });
      await repo.insert(evidencia);
      return { evidencia: await repo.findOneByOrFail({ id: evidencia.id }), duplicada: false };
    } catch (error) {
      // Carrera con otro envío simultáneo: la restricción única (0..1) decide quién gana.
      const otra = await repo.findOneBy({ incidente: { id: incidenteId } });
      if (otra?.sha256 === sha256) return { evidencia: otra, duplicada: true };
      await this.almacen.borrar(urlArchivo); // nuestro archivo quedó huérfano
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
    return { datos: await this.almacen.leer(evidencia.urlArchivo), tipoMime: evidencia.tipoMime };
  }
}
