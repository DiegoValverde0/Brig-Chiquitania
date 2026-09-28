import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { AsignacionDespacho } from '../../despacho/entities/asignacion-despacho.entity';

/** Informe de cierre de una operación (base para la liquidación de la brigada). */
@Entity('informe_consolidado')
export class InformeConsolidado extends EntidadBase {
  @Column({ type: 'text' })
  resumen: string;

  @Column({ name: 'fecha_cierre', type: 'timestamptz' })
  fechaCierre: Date;

  @Column({ name: 'hectareas_afectadas', type: 'numeric', precision: 10, scale: 2, nullable: true })
  hectareasAfectadas: string | null;

  @OneToOne(() => AsignacionDespacho, { nullable: false })
  @JoinColumn({ name: 'asignacion_id' })
  asignacion: Relation<AsignacionDespacho>;
}
