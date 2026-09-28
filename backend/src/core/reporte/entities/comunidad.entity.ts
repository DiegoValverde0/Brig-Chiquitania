import { Column, Entity, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Coordenada } from './coordenada.entity';
import { ContactoComunal } from './contacto-comunal.entity';

/**
 * Comunidad habitada: única referencia válida para el riesgo (<5 km ⇒ Alto).
 * Las estancias o predios privados no se registran aquí (su exclusión explícita llega en el Bolt 2).
 */
@Entity('comunidad')
export class Comunidad extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column(() => Coordenada, { prefix: false })
  coordenadas: Coordenada;

  /** Composición 1–1: contacto obligatorio y bloqueante para el despacho. */
  @OneToOne(() => ContactoComunal, (contacto) => contacto.comunidad)
  contacto?: Relation<ContactoComunal> | null;
}
