import { Column, Entity } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';

/** Punto geográfico crudo (WGS84). Sin PostGIS en el MVP. */
@Entity('coordenada')
export class Coordenada extends EntidadBase {
  @Column({ type: 'double precision' })
  latitud: number;

  @Column({ type: 'double precision' })
  longitud: number;

  @Column({ name: 'precision_metros', type: 'real', nullable: true })
  precisionMetros: number | null;
}
