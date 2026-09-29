import { Column, Entity, JoinColumn, ManyToOne, OneToOne, Relation } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { CoordenadaCifrada } from '../../reporte/entities/coordenada-cifrada.entity';
import { EvidenciaFotografica } from '../../reporte/entities/evidencia-fotografica.entity';
import { Comunidad } from '../../reporte/entities/comunidad.entity';
import { Rumbo } from '../../reporte/enums/rumbo.enum';
import { TipoReporte } from '../../reporte/enums/tipo-reporte.enum';
import { NivelRiesgo } from '../enums/nivel-riesgo.enum';
import { EstadoIncidente } from '../enums/estado-incidente.enum';
import { OrigenRiesgo } from '../enums/origen-riesgo.enum';
import { ResultadoCierre } from '../enums/resultado-cierre.enum';
import type { FactoresRiesgo } from '../motor-riesgo.service';
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

  /**
   * Explicación visible del cálculo del motor (p. ej. "Amenaza directa a vida humana comunitaria").
   * Se conserva aunque el coordinador reclasifique: la justificación manual queda en el historial (HU-2.2).
   */
  @Column({ name: 'justificacion_riesgo', type: 'text', nullable: true })
  justificacionRiesgo: string | null;

  /** Si el nivel vigente lo fijó el motor o una reclasificación manual (HU-2.2). */
  @Column({ name: 'origen_riesgo', type: 'enum', enum: OrigenRiesgo, default: OrigenRiesgo.Motor })
  origenRiesgo: OrigenRiesgo;

  /** RF-05: factores que evaluó el motor (versión, regla, umbrales, comunidad, predios excluidos). */
  @Column({ name: 'factores_riesgo', type: 'jsonb', nullable: true })
  factoresRiesgo: FactoresRiesgo | null;

  @Column({ name: 'resultado_cierre', type: 'enum', enum: ResultadoCierre, nullable: true })
  resultadoCierre: ResultadoCierre | null;

  /** Composición 1–1 con Coordenada (columnas embebidas, latitud y longitud cifradas: RNF-08). */
  @Column(() => CoordenadaCifrada, { prefix: false })
  coordenada: CoordenadaCifrada;

  /** HU-1.2: hito cardinal del avistamiento a distancia (nulo en reportes GPS) [inferencia de atributo]. */
  @Column({ type: 'enum', enum: Rumbo, nullable: true })
  rumbo: Rumbo | null;

  /** HU-1.2: distancia estimada en km desde la comunidad de referencia (nulo en reportes GPS). */
  @Column({ name: 'distancia_estimada_km', type: 'real', nullable: true })
  distanciaEstimadaKm: number | null;

  /** 0..1: comunidad habitada más cercana, fuente del contacto comunal obligatorio. */
  @ManyToOne(() => Comunidad, { nullable: true })
  @JoinColumn({ name: 'comunidad_id' })
  comunidad: Relation<Comunidad> | null;

  /** Multiplicidad 0..1 (Ley N.º 602): la carta municipal puede no existir aún. */
  @OneToOne(() => CartaMunicipal, (carta) => carta.incidente)
  cartaMunicipal?: Relation<CartaMunicipal> | null;

  /** 0..1: fotografía opcional del reporte (HU-1.1, RF-03). */
  @OneToOne(() => EvidenciaFotografica, (evidencia) => evidencia.incidente)
  evidencia?: Relation<EvidenciaFotografica> | null;

  /**
   * Bolt 4: foco que estaba controlado (En Liquidación) y el coordinador reactivó porque vuelve a ser riesgoso
   * [inferencia de atributos, decisión 7.2 del PO]. Encabeza su columna en el panel.
   */
  @Column({ name: 'reactivado_en', type: 'timestamptz', nullable: true })
  reactivadoEn: Date | null;

  @Column({ type: 'int', default: 0 })
  reactivaciones: number;

  /** ΔT del KPI en minutos (HU-5.3): T_llegada − T_reporte. */
  calcularTiempoDespacho(llegada: Date): number {
    return (llegada.getTime() - this.fechaReporte.getTime()) / 60000;
  }
}
