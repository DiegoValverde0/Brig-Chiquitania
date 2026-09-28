import { Column, Entity } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';

/** Persona de la comunidad que reporta o sirve de enlace en terreno. */
@Entity('contacto_comunal')
export class ContactoComunal extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'varchar', length: 20 })
  telefono: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  comunidad: string | null;
}
