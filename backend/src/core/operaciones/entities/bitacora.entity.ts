import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from 'typeorm';
import { Brigada } from '../../despacho/entities/brigada.entity';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Incidente } from '../../triage/entities/incidente.entity';
import { NivelAgua, NivelCombustible } from '../enums/nivel-bitacora.enum';

/**
 * UML `Bitacora` (Bolt 5, HU-5.2, RF-12): bitácora de turno por **checklist**, nunca texto libre (reemplaza el
 * WhatsApp; Acta ACTA-002, acuerdo 3). Incidente 1 — 0..*. El id lo genera el teléfono (idempotencia offline).
 * Inmutable una vez sincronizada (UML): la BD rechaza UPDATE y DELETE (AuditoriaInmutableService).
 * No extiende EntidadBase porque no tiene `actualizado_en`: nunca se actualiza.
 */
@Entity('bitacora')
export class Bitacora {
  @PrimaryColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  /** Momento en que el jefe llenó el checklist en el teléfono (puede ser anterior a la sincronización). */
  @Column({ type: 'timestamptz' })
  fecha: Date;

  @Column({ name: 'nivel_agua', type: 'enum', enum: NivelAgua })
  nivelAgua: NivelAgua;

  @Column({ name: 'nivel_combustible', type: 'enum', enum: NivelCombustible })
  nivelCombustible: NivelCombustible;

  @Column({ name: 'herramientas_operativas', type: 'boolean' })
  herramientasOperativas: boolean;

  @Column({ name: 'km_faja_mitigados', type: 'real' })
  kmFajaMitigados: number;

  @Column({ name: 'porcentaje_control', type: 'smallint' })
  porcentajeControl: number;

  /** El % de control bajó respecto de la bitácora anterior (un rebrote); se marca en el informe (decisión 7.4). */
  @Column({ name: 'control_retrocede', type: 'boolean', default: false })
  controlRetrocede: boolean;

  /** Canal por el que llegó: la app (datos) o el SMS `BRC1 B` (RNF-02) [inferencia]. */
  @Column({ type: 'varchar', length: 3, default: 'App' })
  canal: string;

  @Index()
  @ManyToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;

  @ManyToOne(() => Brigada, { nullable: false })
  @JoinColumn({ name: 'brigada_id' })
  brigada: Relation<Brigada>;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario> | null;
}
