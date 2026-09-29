import { Rol } from '../seguridad/enums/rol.enum';
import { EstadoBrigada } from './enums/estado-brigada.enum';
import { validarTransicionTactica } from './estado-tactico';

describe('validarTransicionTactica (RF-08, Acta ACTA-002 acuerdo 4)', () => {
  const { Disponible, En_Desplazamiento, En_Combate_Activo, En_Liquidacion } = EstadoBrigada;

  it('el jefe de la brigada reporta "En Liquidación" desde "En Combate Activo"', () => {
    expect(validarTransicionTactica(En_Combate_Activo, En_Liquidacion, Rol.JefeBrigada, true)).toBeNull();
  });

  it('otro jefe, el coordinador o un guardaparque no pueden reportarla (403)', () => {
    expect(validarTransicionTactica(En_Combate_Activo, En_Liquidacion, Rol.JefeBrigada, false)?.tipo).toBe('prohibido');
    expect(validarTransicionTactica(En_Combate_Activo, En_Liquidacion, Rol.Coordinador, false)?.tipo).toBe('prohibido');
    expect(validarTransicionTactica(En_Combate_Activo, En_Liquidacion, Rol.Guardaparque, false)?.tipo).toBe('prohibido');
  });

  it('"En Liquidación" solo desde "En Combate Activo" (409)', () => {
    for (const actual of [Disponible, En_Desplazamiento, En_Liquidacion]) {
      expect(validarTransicionTactica(actual, En_Liquidacion, Rol.JefeBrigada, true)?.tipo).toBe('conflicto');
    }
  });

  it('solo el coordinador libera ("Disponible") y solo desde "En Liquidación"', () => {
    expect(validarTransicionTactica(En_Liquidacion, Disponible, Rol.Coordinador, false)).toBeNull();
    expect(validarTransicionTactica(En_Liquidacion, Disponible, Rol.JefeBrigada, true)?.tipo).toBe('prohibido');
    for (const actual of [Disponible, En_Desplazamiento, En_Combate_Activo]) {
      expect(validarTransicionTactica(actual, Disponible, Rol.Coordinador, false)?.tipo).toBe('conflicto');
    }
  });
});
