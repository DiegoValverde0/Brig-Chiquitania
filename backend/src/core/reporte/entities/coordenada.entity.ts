import { Column } from 'typeorm';

/**
 * Punto geográfico crudo (WGS84), sin PostGIS en el MVP.
 * Valor embebido (composición del UML): se guarda como columnas de la entidad dueña
 * (Incidente, Comunidad, Brigada), sin tabla propia.
 */
export class Coordenada {
  @Column({ type: 'double precision' })
  latitud: number;

  @Column({ type: 'double precision' })
  longitud: number;

  /** ≤15 m para un GPS nativo (RF-01); nulo cuando no aplica (p. ej. catálogo de comunidades). */
  @Column({ name: 'precision_metros', type: 'real', nullable: true })
  precisionMetros: number | null;
}
