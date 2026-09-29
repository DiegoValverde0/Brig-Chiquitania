import { Column } from 'typeorm';
import { numeroCifrado } from '../../../common/cifrado';

/**
 * Ubicación del foco reportado, cifrada en reposo (RNF-08: los datos de ubicación del reporte son sensibles).
 * Mismas propiedades que `Coordenada`, pero latitud y longitud se guardan como texto AES-256-GCM.
 * Las distancias se calculan en la aplicación (motor de riesgo, sugerencia de brigadas), nunca en SQL, así que
 * cifrar no afecta la lógica. Las coordenadas del catálogo (comunidades, brigadas) no son datos personales y
 * siguen en claro.
 */
export class CoordenadaCifrada {
  @Column({ type: 'text', transformer: numeroCifrado })
  latitud: number;

  @Column({ type: 'text', transformer: numeroCifrado })
  longitud: number;

  /** ≤15 m para un GPS nativo (RF-01); nulo cuando la ubicación es aproximada (reporte a distancia). */
  @Column({ name: 'precision_metros', type: 'real', nullable: true })
  precisionMetros: number | null;
}
