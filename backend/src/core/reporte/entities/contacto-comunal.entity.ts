import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { textoCifrado } from '../../../common/cifrado';
import { EntidadBase } from '../../../common/entidad-base';
import { Comunidad } from './comunidad.entity';

/**
 * Referente comunal (cacique, corregidor…): obligatorio en la orden de salida (ACTA-002, acuerdo 5).
 * Nombre y teléfono cifrados en reposo (RNF-08); los largos se validan en la API antes de cifrar.
 */
@Entity('contacto_comunal')
export class ContactoComunal extends EntidadBase {
  @Column({ name: 'nombre_autoridad', type: 'text', transformer: textoCifrado })
  nombreAutoridad: string;

  @Column({ type: 'text', transformer: textoCifrado })
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
