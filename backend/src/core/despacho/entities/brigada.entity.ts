import { Column, Entity, JoinColumn, OneToMany, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Usuario } from '../../seguridad/entities/usuario.entity';
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

  /** UML: JefeBrigada "lidera" Brigada (1–1). Solo él reporta el estado táctico "En Liquidación" (Bolt 3). */
  @OneToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'jefe_id' })
  jefe: Relation<Usuario> | null;

  @OneToMany(() => AsignacionDespacho, (asignacion) => asignacion.brigada)
  asignaciones: Relation<AsignacionDespacho>[];
}
