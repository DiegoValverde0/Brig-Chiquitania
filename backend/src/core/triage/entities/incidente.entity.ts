import { Column, Entity, JoinColumn, ManyToOne, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { Coordenada } from '../../reporte/entities/coordenada.entity';
import { Comunidad } from '../../reporte/entities/comunidad.entity';
import { TipoReporte } from '../../reporte/enums/tipo-reporte.enum';
import { NivelRiesgo } from '../enums/nivel-riesgo.enum';
import { EstadoIncidente } from '../enums/estado-incidente.enum';
import { ResultadoCierre } from '../enums/resultado-cierre.enum';
import { CartaMunicipal } from './carta-municipal.entity';

@Entity('incidente')
export class Incidente extends EntidadBase {
  @Column({ name: 'tipo_reporte', type: 'enum', enum: TipoReporte, default: TipoReporte.GPS })
  tipoReporte: TipoReporte;

  /** Nulo hasta que el motor de riesgo lo calcula. */
  @Column({ name: 'nivel_riesgo', type: 'enum', enum: NivelRiesgo, nullable: true })
  nivelRiesgo: NivelRiesgo | null;

  @Column({ type: 'enum', enum: EstadoIncidente, default: EstadoIncidente.Nuevo })
  estado: EstadoIncidente;

  /** T_reporte del KPI (HU-5.3). Write-once: protegido en la BD desde el Bolt 0 (RNF-07). */
  @Column({ name: 'fecha_reporte', type: 'timestamptz', default: () => 'now()' })
  fechaReporte: Date;

  /** Explicación visible del nivel de riesgo (p. ej. "Amenaza directa a vida humana comunitaria"). */
  @Column({ name: 'justificacion_riesgo', type: 'text', nullable: true })
  justificacionRiesgo: string | null;

  @Column({ name: 'resultado_cierre', type: 'enum', enum: ResultadoCierre, nullable: true })
  resultadoCierre: ResultadoCierre | null;

  /** Composición 1–1 con Coordenada (columnas embebidas). */
  @Column(() => Coordenada, { prefix: false })
  coordenada: Coordenada;

  /** 0..1: comunidad habitada más cercana, fuente del contacto comunal obligatorio. */
  @ManyToOne(() => Comunidad, { nullable: true })
  @JoinColumn({ name: 'comunidad_id' })
  comunidad: Relation<Comunidad> | null;

  /** Multiplicidad 0..1 (Ley N.º 602): la carta municipal puede no existir aún. */
  @OneToOne(() => CartaMunicipal, (carta) => carta.incidente)
  cartaMunicipal?: Relation<CartaMunicipal> | null;
}
