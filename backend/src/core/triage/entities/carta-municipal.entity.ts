import { Column, Entity, JoinColumn, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { EstadoTramite } from '../enums/estado-tramite.enum';
import { Incidente } from './incidente.entity';

/** Respaldo documental municipal del incidente (Ley N.º 602 de Gestión de Riesgos). */
@Entity('carta_municipal')
export class CartaMunicipal extends EntidadBase {
  /** Ruta o URL del documento escaneado. */
  @Column({ name: 'archivo_digital', type: 'varchar', length: 500 })
  archivoDigital: string;

  @Column({
    name: 'estado_tramite',
    type: 'enum',
    enum: EstadoTramite,
    default: EstadoTramite.Pendiente,
  })
  estadoTramite: EstadoTramite;

  /** Lado propietario: FK única, a lo sumo una carta por incidente. */
  @OneToOne(() => Incidente, (incidente) => incidente.cartaMunicipal, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'incidente_id' })
  incidente: Relation<Incidente>;
}
