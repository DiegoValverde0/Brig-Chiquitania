import { Column, Entity, JoinColumn, ManyToOne, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Coordenada } from '../../reporte/entities/coordenada.entity';
import { ContactoComunal } from '../../reporte/entities/contacto-comunal.entity';
import { NivelRiesgo } from '../enums/nivel-riesgo.enum';
import { EstadoIncidente } from '../enums/estado-incidente.enum';
import { CartaMunicipal } from './carta-municipal.entity';

@Entity('incidente')
export class Incidente extends EntidadBase {
  @Column({ name: 'nivel_riesgo', type: 'enum', enum: NivelRiesgo, nullable: true })
  nivelRiesgo: NivelRiesgo | null;

  @Column({ type: 'enum', enum: EstadoIncidente, default: EstadoIncidente.Reportado })
  estado: EstadoIncidente;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @ManyToOne(() => Coordenada, { nullable: false, cascade: ['insert'] })
  @JoinColumn({ name: 'coordenada_id' })
  coordenada: Relation<Coordenada>;

  @ManyToOne(() => ContactoComunal, { nullable: true })
  @JoinColumn({ name: 'reportante_id' })
  reportante: Relation<ContactoComunal> | null;

  /** Multiplicidad 0..1 (Ley N.º 602): la carta municipal puede no existir aún. */
  @OneToOne(() => CartaMunicipal, (carta) => carta.incidente)
  cartaMunicipal?: Relation<CartaMunicipal> | null;
}
