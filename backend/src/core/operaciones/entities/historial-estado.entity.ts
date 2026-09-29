import { Column, Entity, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Incidente } from '../../triage/entities/incidente.entity';
import { EstadoIncidente } from '../../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../../triage/enums/nivel-riesgo.enum';
import { TipoEventoHistorial } from '../enums/tipo-evento-historial.enum';

/**
 * Bitácora de auditoría del ciclo de vida del incidente (RNF-07): transiciones de estado y reclasificaciones
 * manuales del riesgo (HU-2.2). Append-only: la BD rechaza UPDATE y DELETE (ver AuditoriaInmutableService).
 */
@Entity('historial_estado')
export class HistorialEstado extends EntidadBase {
  @ManyToOne(() => Incidente, { nullable: false })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;

  @Column({ name: 'tipo_evento', type: 'enum', enum: TipoEventoHistorial, default: TipoEventoHistorial.CambioEstado })
  tipoEvento: TipoEventoHistorial;

  @Column({ name: 'estado_anterior', type: 'enum', enum: EstadoIncidente, nullable: true })
  estadoAnterior: EstadoIncidente | null;

  @Column({ name: 'estado_nuevo', type: 'enum', enum: EstadoIncidente })
  estadoNuevo: EstadoIncidente;

  /** Solo en reclasificaciones: nivel de riesgo antes y después (HU-2.2). */
  @Column({ name: 'nivel_anterior', type: 'enum', enum: NivelRiesgo, nullable: true })
  nivelAnterior: NivelRiesgo | null;

  @Column({ name: 'nivel_nuevo', type: 'enum', enum: NivelRiesgo, nullable: true })
  nivelNuevo: NivelRiesgo | null;

  /** Obligatoria (UML): motivo del cambio, automático o humano (≥15 caracteres si es una reclasificación). */
  @Column({ type: 'text' })
  justificacion: string;

  /** Quién hizo el cambio (HU-2.2: "quién, cuándo y el motivo"). Nulo en entradas automáticas (p. ej. SMS). */
  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario> | null;
}
