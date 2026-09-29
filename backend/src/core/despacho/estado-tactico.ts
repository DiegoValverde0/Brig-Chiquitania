import { Rol } from '../seguridad/enums/rol.enum';
import { EstadoBrigada } from './enums/estado-brigada.enum';

/** Estados que se reportan a mano (Bolt 3). El resto de transiciones las producen el despacho y la llegada. */
export const ESTADOS_TACTICOS_REPORTABLES = [EstadoBrigada.En_Liquidacion, EstadoBrigada.Disponible] as const;
export type EstadoTacticoReportable = (typeof ESTADOS_TACTICOS_REPORTABLES)[number];

export type ErrorTransicion = { tipo: 'prohibido' | 'conflicto'; mensaje: string };

/**
 * Reglas de los estados tácticos reportados a mano (RF-08; Acta ACTA-002, acuerdo 4). Función pura.
 * - "En Liquidación / Por Finalizar": la reporta el Jefe de la brigada, estando "En Combate Activo".
 * - "Disponible": el Coordinador libera una brigada que estaba "En Liquidación".
 */
export function validarTransicionTactica(
  actual: EstadoBrigada,
  nuevo: EstadoTacticoReportable,
  rol: Rol,
  esSuJefe: boolean,
): ErrorTransicion | null {
  if (nuevo === EstadoBrigada.En_Liquidacion) {
    if (rol !== Rol.JefeBrigada || !esSuJefe) {
      return { tipo: 'prohibido', mensaje: 'Solo el jefe de esta brigada reporta "En Liquidación"' };
    }
    if (actual !== EstadoBrigada.En_Combate_Activo) {
      return { tipo: 'conflicto', mensaje: `La brigada está "${actual}": solo pasa a En Liquidación desde En Combate Activo` };
    }
    return null;
  }
  if (rol !== Rol.Coordinador) {
    return { tipo: 'prohibido', mensaje: 'Solo el coordinador libera una brigada (Disponible)' };
  }
  if (actual !== EstadoBrigada.En_Liquidacion) {
    return { tipo: 'conflicto', mensaje: `La brigada está "${actual}": solo se libera desde En Liquidación` };
  }
  return null;
}
