import { Column, Entity } from 'typeorm';
import { textoCifrado } from '../../../common/cifrado';
import { EntidadBase } from '../../../common/entidad-base';
import { Rol } from '../enums/rol.enum';

/**
 * Usuario del sistema (MT-2). El UML lo modela como clase abstracta con cuatro subclases [inferencia del
 * equipo]; aquí es una sola tabla con `rol` (herencia de tabla única), porque las subclases solo difieren en
 * las acciones habilitadas, que se controlan por rol en la API (RNF-08).
 *
 * Autenticación por token de acceso: el dispositivo guarda el token; la BD solo guarda su SHA-256.
 */
@Entity('usuario')
export class Usuario extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'enum', enum: Rol })
  rol: Rol;

  /** Canal SMS del usuario (UML: telefono). Cifrado en reposo. */
  @Column({ type: 'text', nullable: true, transformer: textoCifrado })
  telefono: string | null;

  @Column({ name: 'token_hash', type: 'char', length: 64, unique: true, select: false })
  tokenHash: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;
}
