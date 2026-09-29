import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { TipoEventoAuditoria } from '../enums/tipo-evento-auditoria.enum';

/**
 * Registro append-only (RNF-07) de acciones que no son transiciones del incidente: carga, reemplazo,
 * validación o rechazo de la carta municipal (Ley 602) y cambios tácticos de brigada (RF-08).
 * La BD rechaza UPDATE, DELETE y TRUNCATE (ver AuditoriaInmutableService).
 */
@Entity('evento_auditoria')
export class EventoAuditoria extends EntidadBase {
  @Column({ type: 'enum', enum: TipoEventoAuditoria })
  tipo: TipoEventoAuditoria;

  /** Entidad afectada: 'carta_municipal' o 'brigada'. */
  @Column({ type: 'varchar', length: 40 })
  entidad: string;

  @Column({ name: 'entidad_id', type: 'uuid' })
  entidadId: string;

  @Index()
  @Column({ name: 'incidente_id', type: 'uuid', nullable: true })
  incidenteId: string | null;

  /** Qué pasó, legible por una persona (motivo del rechazo, estado anterior y nuevo, etc.). */
  @Column({ type: 'text' })
  detalle: string;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Relation<Usuario> | null;
}
