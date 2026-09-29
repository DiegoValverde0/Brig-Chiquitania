import { Column, Entity } from 'typeorm';
import { EntidadBase } from '../../../common/entidad-base';
import { TipoPredio } from '../enums/tipo-predio.enum';
import { Coordenada } from './coordenada.entity';

/**
 * Estancia o predio privado del catálogo (HU-2.1: "excluye explícitamente priorizar estancias o propiedades
 * privadas individuales"). El motor de riesgo lo usa solo para explicar la exclusión; nunca eleva la prioridad.
 * [inferencia] El UML no lo modela como clase; sin este catálogo la exclusión no sería verificable (Bolt 2).
 */
@Entity('predio_privado')
export class PredioPrivado extends EntidadBase {
  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ type: 'enum', enum: TipoPredio, default: TipoPredio.Estancia })
  tipo: TipoPredio;

  /** Ubicación de referencia del predio (catálogo, en claro como las comunidades). */
  @Column(() => Coordenada, { prefix: false })
  coordenadas: Coordenada;
}
