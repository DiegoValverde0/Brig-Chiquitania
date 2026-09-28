import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Incidente } from '../../triage/entities/incidente.entity';
import { EstadoAsignacion } from '../enums/estado-asignacion.enum';
import { Brigada } from './brigada.entity';

/** Asociación Brigada — Incidente creada al despachar. */
@Entity('asignacion_despacho')
export class AsignacionDespacho extends EntidadBase {
  @Column({ name: 'fecha_asignacion', type: 'timestamptz', default: () => 'now()' })
  fechaAsignacion: Date;

  @Column({ type: 'enum', enum: EstadoAsignacion, default: EstadoAsignacion.Asignada })
  estado: EstadoAsignacion;

  @ManyToOne(() => Brigada, (brigada) => brigada.asignaciones, { nullable: false })
  @JoinColumn({ name: 'brigada_id' })
  brigada: Relation<Brigada>;

  @ManyToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;
}
