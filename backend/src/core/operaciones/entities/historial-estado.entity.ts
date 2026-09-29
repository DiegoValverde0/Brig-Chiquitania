import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Incidente } from '../../triage/entities/incidente.entity';
import { EstadoIncidente } from '../../triage/enums/estado-incidente.enum';

/**
 * Bitácora de auditoría del ciclo de vida del incidente (RNF-07).
 * Append-only: la BD rechaza UPDATE y DELETE (ver AuditoriaInmutableService).
 */
@Entity('historial_estado')
export class HistorialEstado extends EntidadBase {
  @ManyToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;

  @Column({ name: 'estado_anterior', type: 'enum', enum: EstadoIncidente, nullable: true })
  estadoAnterior: EstadoIncidente | null;

  @Column({ name: 'estado_nuevo', type: 'enum', enum: EstadoIncidente })
  estadoNuevo: EstadoIncidente;

  /** Obligatoria (UML): motivo del cambio, automático o humano. */
  @Column({ type: 'text' })
  justificacion: string;

  /** Quién hizo el cambio (HU-2.2: "quién, cuándo y el motivo"). Nulo en entradas automáticas (p. ej. SMS). */
  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario> | null;
}
