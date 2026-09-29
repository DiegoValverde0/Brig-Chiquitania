import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Incidente } from '../../triage/entities/incidente.entity';
import { ResultadoCierre } from '../../triage/enums/resultado-cierre.enum';

/**
 * UML `InformeConsolidado` (Bolt 5, HU-5.4, RF-13): compila las bitácoras y el ciclo del incidente en un PDF
 * inmutable (RNF-07: la BD rechaza UPDATE y DELETE). Incidente 1 — 0..1.
 */
@Entity('informe_consolidado')
export class InformeConsolidado {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'fecha_generacion', type: 'timestamptz' })
  fechaGeneracion: Date;

  /** UML `contenidoPDF`: ruta del PDF cifrado en el almacén de archivos. */
  @Column({ name: 'contenido_pdf', type: 'varchar', length: 200 })
  contenidoPDF: string;

  /** Integridad del documento entregado [inferencia]. */
  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ name: 'peso_kb', type: 'real' })
  pesoKB: number;

  /** ΔT en minutos (HU-5.3); null si nunca hubo llegada (p. ej. falso positivo descartado sin despacho). */
  @Column({ name: 'tiempo_total_despacho', type: 'int', nullable: true })
  tiempoTotalDespacho: number | null;

  @Column({ name: 'justificacion_falso_positivo', type: 'text', nullable: true })
  justificacionFalsoPositivo: string | null;

  /** Copia del resultado del cierre para listar informes sin descifrar el PDF [inferencia]. */
  @Column({ type: 'enum', enum: ResultadoCierre })
  resultado: ResultadoCierre;

  @OneToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario> | null;
}
