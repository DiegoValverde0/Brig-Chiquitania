import { Column, Entity, Index, JoinColumn, ManyToOne, Relation } from 'typeorm';
import { textoCifrado } from '../../../common/cifrado';
import { EntidadBase } from '../../../common/entidad-base';
import { CanalNotificacion, EstadoEnvio } from '../enums/canal-notificacion.enum';
import { AsignacionDespacho } from './asignacion-despacho.entity';

/**
 * UML `Notificacion` (Bolt 4, HU-4.2, RF-11): cada aviso al jefe de brigada de una asignación (1..*).
 * El contenido lleva coordenadas y el teléfono del referente comunal: va cifrado (RNF-08).
 */
@Entity('notificacion')
export class Notificacion extends EntidadBase {
  @Column({ type: 'enum', enum: CanalNotificacion })
  canal: CanalNotificacion;

  @Column({ type: 'text', transformer: textoCifrado })
  contenido: string;

  @Column({ name: 'estado_envio', type: 'enum', enum: EstadoEnvio, default: EstadoEnvio.Pendiente })
  estadoEnvio: EstadoEnvio;

  /** Motivo de un fallo o del uso del respaldo SMS [inferencia]. */
  @Column({ type: 'text', nullable: true })
  detalle: string | null;

  @Column({ name: 'enviada_en', type: 'timestamptz', nullable: true })
  enviadaEn: Date | null;

  @Column({ name: 'leida_en', type: 'timestamptz', nullable: true })
  leidaEn: Date | null;

  @Index()
  @ManyToOne(() => AsignacionDespacho, { nullable: false })
  @JoinColumn({ name: 'asignacion_id' })
  asignacion: Relation<AsignacionDespacho>;
}
