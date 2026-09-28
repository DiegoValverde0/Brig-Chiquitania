import { Column, Entity, OneToMany, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { EstadoOperativo } from '../enums/estado-operativo.enum';
import { AsignacionDespacho } from './asignacion-despacho.entity';

@Entity('brigada')
export class Brigada extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({
    name: 'estado_operativo',
    type: 'enum',
    enum: EstadoOperativo,
    default: EstadoOperativo.Disponible,
  })
  estadoOperativo: EstadoOperativo;

  @OneToMany(() => AsignacionDespacho, (asignacion) => asignacion.brigada)
  asignaciones: Relation<AsignacionDespacho>[];
}
