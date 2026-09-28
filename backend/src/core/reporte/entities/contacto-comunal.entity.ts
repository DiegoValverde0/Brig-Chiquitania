import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Comunidad } from './comunidad.entity';

/** Referente comunal (cacique, corregidor…): obligatorio en la orden de salida (ACTA-002, acuerdo 5). */
@Entity('contacto_comunal')
export class ContactoComunal extends EntidadBase {
  @Column({ name: 'nombre_autoridad', type: 'varchar', length: 120 })
  nombreAutoridad: string;

  @Column({ type: 'varchar', length: 20 })
  telefono: string;

  @Column({ type: 'varchar', length: 60 })
  cargo: string;

  /** Lado propietario de la composición: un contacto por comunidad. */
  @OneToOne(() => Comunidad, (comunidad) => comunidad.contacto, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'comunidad_id' })
  comunidad: Relation<Comunidad>;

  validarNoVacio(): boolean {
    return this.nombreAutoridad.trim().length > 0 && this.telefono.trim().length > 0;
  }
}
