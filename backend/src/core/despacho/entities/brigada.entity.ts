import { Column, Entity, OneToMany, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Coordenada } from '../../reporte/entities/coordenada.entity';
import { EstadoBrigada } from '../enums/estado-brigada.enum';
import { AsignacionDespacho } from './asignacion-despacho.entity';

@Entity('brigada')
export class Brigada extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({
    name: 'estado_operativo',
    type: 'enum',
    enum: EstadoBrigada,
    default: EstadoBrigada.Disponible,
  })
  estadoOperativo: EstadoBrigada;

  /** Base de la sugerencia por cercanía (RF-09). */
  @Column(() => Coordenada, { prefix: false })
  ubicacionActual: Coordenada;

  @OneToMany(() => AsignacionDespacho, (asignacion) => asignacion.brigada)
  asignaciones: Relation<AsignacionDespacho>[];
}
