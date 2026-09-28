import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { AsignacionDespacho } from '../../despacho/entities/asignacion-despacho.entity';

/** Entrada de registro en terreno durante una operación. */
@Entity('bitacora')
export class Bitacora extends EntidadBase {
  @Column({ name: 'fecha_hora', type: 'timestamptz' })
  fechaHora: Date;

  @Column({ type: 'text' })
  descripcion: string;

  @ManyToOne(() => AsignacionDespacho, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asignacion_id' })
  asignacion: Relation<AsignacionDespacho>;
}
