import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { BrigadaParaDespacho, candidatas, despachoDeTarjeta, elegibilidad } from './elegibilidad';
import { EstadoBrigada } from './enums/estado-brigada.enum';

const FOCO = { latitud: -16.1333, longitud: -62.0258 };
const aKm = (km: number) => ({ latitud: FOCO.latitud + km / 111.195, longitud: FOCO.longitud });

function brigada(id: string, estado: EstadoBrigada, km: number, jefeConTelefono = true): BrigadaParaDespacho {
  return { id, nombre: `B${id}`, estadoOperativo: estado, ubicacion: aKm(km), version: 3, jefeConTelefono, incidente: null };
}

describe('elegibilidad (HU-4.3, RF-10)', () => {
  const { Disponible, En_Desplazamiento, En_Combate_Activo, En_Liquidacion } = EstadoBrigada;

  it('una brigada Disponible siempre es candidata', () => {
    expect(elegibilidad(Disponible, NivelRiesgo.Medio, 200)).toBe('disponible');
  });

  it('En Liquidación solo para un foco Alto a menos de 30 km (reasignación táctica)', () => {
    expect(elegibilidad(En_Liquidacion, NivelRiesgo.Alto, 12)).toBe('reasignacion');
    expect(elegibilidad(En_Liquidacion, NivelRiesgo.Alto, 30)).toBeNull();
    expect(elegibilidad(En_Liquidacion, NivelRiesgo.Medio, 5)).toBeNull();
  });

  it('en desplazamiento o en combate nunca es candidata', () => {
    expect(elegibilidad(En_Desplazamiento, NivelRiesgo.Alto, 1)).toBeNull();
    expect(elegibilidad(En_Combate_Activo, NivelRiesgo.Alto, 1)).toBeNull();
  });

  it('ordena primero las reasignaciones (Acta: no enviar desde la capital) y luego por cercanía', () => {
    const lista = candidatas({ coordenada: FOCO, nivelRiesgo: NivelRiesgo.Alto }, [
      brigada('1', Disponible, 3),
      brigada('2', En_Liquidacion, 20),
      brigada('3', En_Liquidacion, 40),
      brigada('4', Disponible, 1),
      brigada('5', En_Combate_Activo, 0.5),
    ]);
    expect(lista.map((c) => [c.id, c.reasignacion])).toEqual([
      ['2', true],
      ['4', false],
      ['1', false],
    ]);
    expect(lista[0]).toMatchObject({ version: 3, despachable: true, distanciaKm: 20 });
  });
});

describe('despachoDeTarjeta (botón DESPACHAR del panel)', () => {
  const foco = { coordenada: FOCO, nivelRiesgo: NivelRiesgo.Alto, tieneCartaMunicipal: true, tieneContactoComunal: true };

  it('sugiere la mejor brigada despachable', () => {
    const r = despachoDeTarjeta(foco, [brigada('1', EstadoBrigada.Disponible, 50), brigada('2', EstadoBrigada.Disponible, 5)]);
    expect(r).toMatchObject({ sugerencia: { id: '2' }, bloqueo: null });
  });

  it('las mismas guardas que la API: riesgo, carta (Ley 602), contacto comunal', () => {
    const b = [brigada('1', EstadoBrigada.Disponible, 5)];
    expect(despachoDeTarjeta({ ...foco, nivelRiesgo: NivelRiesgo.Bajo }, b).bloqueo).toMatch(/Riesgo Bajo/);
    expect(despachoDeTarjeta({ ...foco, tieneCartaMunicipal: false }, b).bloqueo).toMatch(/Ley 602/);
    expect(despachoDeTarjeta({ ...foco, tieneContactoComunal: false }, b).bloqueo).toMatch(/contacto comunal/);
    expect(despachoDeTarjeta(foco, []).bloqueo).toBe('Sin brigada disponible');
  });

  it('decisión 7.4: sin jefe con teléfono la brigada no se despacha y se dice por qué', () => {
    const r = despachoDeTarjeta(foco, [brigada('1', EstadoBrigada.Disponible, 5, false)]);
    expect(r).toEqual({ sugerencia: null, bloqueo: 'B1 no tiene jefe con teléfono registrado' });
    const conOtra = despachoDeTarjeta(foco, [brigada('1', EstadoBrigada.Disponible, 5, false), brigada('2', EstadoBrigada.Disponible, 80)]);
    expect(conOtra.sugerencia?.id).toBe('2');
  });
});
