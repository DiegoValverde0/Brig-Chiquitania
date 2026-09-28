import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Incidente } from '../../triage/entities/incidente.entity';
import { EstadoIncidente } from '../../triage/enums/estado-incidente.enum';

/**
 * Bitácora de auditoría del ciclo de vida del incidente (RNF-07).
 * Append-only: la BD rechaza UPDATE y DELETE (ver AuditoriaInmutableService).
 * El "quién" se agrega con Usuario/roles en el Bolt 1.
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
}
