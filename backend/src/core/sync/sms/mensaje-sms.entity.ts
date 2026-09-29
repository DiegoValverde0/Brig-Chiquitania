import { Column, Entity, Index } from 'typeorm';
import { textoCifrado } from '../../../common/cifrado';
import { EntidadBase } from '../../../common/entidad-base';

export enum DireccionSms {
  Entrante = 'Entrante',
  Saliente = 'Saliente',
}

export enum EstadoSms {
  /** Entrante decodificado y convertido en reporte (o reintento reconocido). */
  Procesado = 'Procesado',
  /** Entrante que no se pudo interpretar o validar. */
  Rechazado = 'Rechazado',
  /** Saliente entregado a la pasarela. */
  Enviado = 'Enviado',
  /** Saliente que la pasarela no pudo enviar. */
  Fallido = 'Fallido',
}

/**
 * Registro de todo SMS entrante y saliente (RNF-02). Sirve de bandeja del proveedor simulado y, con un proveedor
 * real, de trazabilidad. Número y texto van cifrados (contienen ubicación y teléfonos: RNF-08).
 */
@Entity('mensaje_sms')
export class MensajeSms extends EntidadBase {
  @Column({ type: 'enum', enum: DireccionSms })
  direccion: DireccionSms;

  @Column({ type: 'text', transformer: textoCifrado })
  numero: string;

  @Column({ type: 'text', transformer: textoCifrado })
  texto: string;

  @Column({ type: 'enum', enum: EstadoSms })
  estado: EstadoSms;

  /** Motivo del rechazo o fallo, o resumen del procesamiento. */
  @Column({ type: 'text', nullable: true })
  detalle: string | null;

  /** Pasarela usada (p. ej. "simulado") e id que asignó al mensaje. */
  @Column({ type: 'varchar', length: 40 })
  proveedor: string;

  @Column({ name: 'id_proveedor', type: 'varchar', length: 100, nullable: true })
  idProveedor: string | null;

  @Index()
  @Column({ name: 'incidente_id', type: 'uuid', nullable: true })
  incidenteId: string | null;
}
