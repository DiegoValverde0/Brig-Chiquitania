import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Incidente } from '../../triage/entities/incidente.entity';

/**
 * Fotografía opcional del reporte (HU-1.1, RF-03): ≤100 KB, con timestamp de captura.
 * El archivo se guarda cifrado (AES-256-GCM, RNF-08) en el almacén de evidencias; aquí solo quedan los metadatos.
 */
@Entity('evidencia_fotografica')
export class EvidenciaFotografica extends EntidadBase {
  /** Ruta relativa del archivo cifrado dentro del almacén de evidencias (UML: urlArchivo). */
  @Column({ name: 'url_archivo', type: 'varchar', length: 200 })
  urlArchivo: string;

  /** Peso de la imagen original en KB (≤100, RF-03). */
  @Column({ name: 'peso_kb', type: 'real' })
  pesoKB: number;

  /** Momento de captura en el dispositivo (RF-03: fotografía con timestamp). */
  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ name: 'tipo_mime', type: 'varchar', length: 30 })
  tipoMime: string;

  /** SHA-256 de la imagen original: reenviar la misma foto (reintento offline) no es un error. */
  @Column({ type: 'char', length: 64 })
  sha256: string;

  /** 0..1 por incidente (lado propietario). */
  @OneToOne(() => Incidente, (incidente) => incidente.evidencia, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;
}
