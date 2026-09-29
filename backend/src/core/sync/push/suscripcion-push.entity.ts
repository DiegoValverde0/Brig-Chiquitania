import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { textoCifrado } from '../../../common/cifrado';
import { EntidadBase } from '../../../common/entidad-base';
import { Usuario } from '../../seguridad/entities/usuario.entity';

/**
 * Suscripción Web Push del navegador de un usuario (Bolt 4, RF-11): a dónde enviar el aviso de despacho.
 * El endpoint identifica al dispositivo: va cifrado (RNF-08) y se indexa por su SHA-256 (un dispositivo, una fila).
 */
@Entity('suscripcion_push')
export class SuscripcionPush extends EntidadBase {
  @ManyToOne(() => Usuario, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario>;

  @Column({ type: 'text', transformer: textoCifrado })
  endpoint: string;

  @Column({ name: 'endpoint_hash', type: 'char', length: 64, unique: true })
  endpointHash: string;

  @Column({ type: 'varchar', length: 100 })
  p256dh: string;

  @Column({ type: 'varchar', length: 40 })
  auth: string;
}
