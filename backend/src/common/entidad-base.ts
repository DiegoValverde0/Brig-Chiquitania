import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Columnas comunes a todas las entidades del dominio.
 * El id es UUID para permitir, en el Bolt de sincronización (core.sync),
 * que los dispositivos offline generen identificadores sin colisiones.
 */
export abstract class EntidadBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'creado_en', type: 'timestamptz' })
  creadoEn: Date;

  @UpdateDateColumn({ name: 'actualizado_en', type: 'timestamptz' })
  actualizadoEn: Date;
}
