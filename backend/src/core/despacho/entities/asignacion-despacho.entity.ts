import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Incidente } from '../../triage/entities/incidente.entity';
import { Brigada } from './brigada.entity';

/** Asociación Brigada — Incidente creada al despachar; su confirmación inicia el cronómetro del KPI. */
@Entity('asignacion_despacho')
export class AsignacionDespacho extends EntidadBase {
  @Column({ name: 'fecha_asignacion', type: 'timestamptz', default: () => 'now()' })
  fechaAsignacion: Date;

  @Column({ name: 'ruta_sugerida', type: 'text', nullable: true })
  rutaSugerida: string | null;

  /** T_llegada del KPI (HU-5.1). Write-once: protegido en la BD desde el Bolt 0 (RNF-07). */
  @Column({ name: 'timestamp_confirmacion_llegada', type: 'timestamptz', nullable: true })
  timestampConfirmacionLlegada: Date | null;

  @ManyToOne(() => Brigada, (brigada) => brigada.asignaciones, { nullable: false })
  @JoinColumn({ name: 'brigada_id' })
  brigada: Relation<Brigada>;

  @ManyToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;
}
