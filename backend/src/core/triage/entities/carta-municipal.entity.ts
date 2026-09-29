import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { EstadoTramite } from '../enums/estado-tramite.enum';
import { Incidente } from './incidente.entity';

/**
 * Carta formal de solicitud de apoyo emitida por la UGR municipal (Ley N.º 602): prerrequisito legal del
 * despacho departamental. Desde el Bolt 3 es el documento real (PDF o imagen ≤1 MB), cifrado en el almacén.
 */
@Entity('carta_municipal')
export class CartaMunicipal extends EntidadBase {
  /**
   * UML: archivoDigital. Ruta del archivo cifrado en el almacén; en cartas anteriores al Bolt 3 es solo una
   * referencia en texto, sin archivo (`sha256` nulo).
   */
  @Column({ name: 'archivo_digital', type: 'varchar', length: 500 })
  archivoDigital: string;

  @Column({ name: 'fecha_emision', type: 'date' })
  fechaEmision: string;

  /** Recibida al adjuntarse (habilita el despacho); el coordinador la Valida o la Rechaza (CU-08). */
  @Column({
    name: 'estado_tramite',
    type: 'enum',
    enum: EstadoTramite,
    default: EstadoTramite.Pendiente,
  })
  estadoTramite: EstadoTramite;

  @Column({ name: 'tipo_mime', type: 'varchar', length: 30, nullable: true })
  tipoMime: string | null;

  @Column({ name: 'peso_kb', type: 'real', nullable: true })
  pesoKB: number | null;

  /** SHA-256 del documento: reenviar el mismo archivo no es un error. Nulo = referencia sin archivo. */
  @Column({ type: 'char', length: 64, nullable: true })
  sha256: string | null;

  /** Motivo del rechazo (obligatorio al rechazar); se limpia si la UGR adjunta una carta nueva. */
  @Column({ name: 'motivo_rechazo', type: 'text', nullable: true })
  motivoRechazo: string | null;

  /** Lado propietario: FK única, a lo sumo una carta por incidente. */
  @OneToOne(() => Incidente, (incidente) => incidente.cartaMunicipal, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;

  /** UML: validar(). Una carta habilita el despacho si existe y no fue rechazada (decisión del PO, Bolt 3). */
  habilitaDespacho(): boolean {
    return this.estadoTramite !== EstadoTramite.Rechazada && this.estadoTramite !== EstadoTramite.Pendiente;
  }
}
