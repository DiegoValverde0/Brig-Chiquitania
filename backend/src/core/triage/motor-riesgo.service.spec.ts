import { NivelRiesgo } from './enums/nivel-riesgo.enum';
import { JUSTIFICACION_ALTO, MotorRiesgoService, UMBRAL_ALTO_KM, UMBRAL_MEDIO_KM } from './motor-riesgo.service';

describe('MotorRiesgoService (HU-2.1, motor-v2)', () => {
  const motor = new MotorRiesgoService();
  const concepcion = { id: 'c1', nombre: 'Concepción', latitud: -16.1333, longitud: -62.0258 };
  const sanJavier = { id: 'c2', nombre: 'San Javier', latitud: -16.2747, longitud: -62.5064 };
  // 1° de latitud ≈ 111,2 km: desplazamientos al norte de Concepción.
  const alNorte = (km: number) => ({ latitud: concepcion.latitud + km / 111.195, longitud: concepcion.longitud });

  it('Alto a <5 km de una comunidad habitada, con el texto exacto de la SRS (DoD 1)', () => {
    const r = motor.evaluar(alNorte(2), [sanJavier, concepcion]);
    expect(r.nivel).toBe(NivelRiesgo.Alto);
    expect(r.justificacion).toBe(`${JUSTIFICACION_ALTO}: Concepción a 2 km`);
    expect(r.comunidadId).toBe('c1');
    expect(r.factores).toMatchObject({
      version: 'motor-v2',
      regla: 'ComunidadAMenosDe5Km',
      umbrales: { altoKm: UMBRAL_ALTO_KM, medioKm: UMBRAL_MEDIO_KM },
      comunidadMasCercana: { id: 'c1', nombre: 'Concepción', distanciaKm: 2 },
      prediosExcluidos: [],
    });
  });

  it('Medio entre 5 y 15 km; Bajo desde 15 km, asociando igual la comunidad (contacto comunal)', () => {
    const medio = motor.evaluar(alNorte(11), [concepcion, sanJavier]);
    expect(medio).toMatchObject({ nivel: NivelRiesgo.Medio, comunidadId: 'c1' });
    expect(medio.justificacion).toMatch(/^Comunidad habitada en el área de influencia: Concepción a 11 km/);
    expect(medio.factores.regla).toBe('ComunidadEntre5y15Km');

    const bajo = motor.evaluar(alNorte(20), [concepcion]);
    expect(bajo).toMatchObject({ nivel: NivelRiesgo.Bajo, comunidadId: 'c1' });
    expect(bajo.factores.regla).toBe('SinComunidadCercana');
  });

  it('los límites son exclusivos: 5 km ya es Medio y 15 km ya es Bajo', () => {
    expect(motor.evaluar(alNorte(4.99), [concepcion]).nivel).toBe(NivelRiesgo.Alto);
    expect(motor.evaluar(alNorte(5.01), [concepcion]).nivel).toBe(NivelRiesgo.Medio);
    expect(motor.evaluar(alNorte(14.99), [concepcion]).nivel).toBe(NivelRiesgo.Medio);
    expect(motor.evaluar(alNorte(15.01), [concepcion]).nivel).toBe(NivelRiesgo.Bajo);
  });

  it('DoD 2: un foco junto a una estancia privada y lejos de comunidades NO sube de prioridad', () => {
    const lejos = alNorte(40);
    const estancia = { nombre: 'El Porvenir', tipo: 'Estancia', latitud: lejos.latitud + 0.005, longitud: lejos.longitud };
    const r = motor.evaluar(lejos, [concepcion], [estancia]);
    expect(r.nivel).toBe(NivelRiesgo.Bajo);
    expect(r.justificacion).toMatch(/Excluido de la priorización automática: Estancia El Porvenir a 0\.56 km$/);
    expect(r.factores.prediosExcluidos).toEqual([{ nombre: 'El Porvenir', tipo: 'Estancia', distanciaKm: 0.56 }]);
  });

  it('con comunidad y estancia cercanas prevalece la comunidad (vida humana primero)', () => {
    const foco = alNorte(3);
    const r = motor.evaluar(foco, [concepcion], [{ nombre: 'La Aurora', tipo: 'Estancia', ...alNorte(3.5) }]);
    expect(r.nivel).toBe(NivelRiesgo.Alto);
    expect(r.justificacion.startsWith(`${JUSTIFICACION_ALTO}: Concepción a 3 km`)).toBe(true);
    expect(r.factores.prediosExcluidos.map((p) => p.nombre)).toEqual(['La Aurora']);
  });

  it('solo lista los predios de la franja evaluada, los 3 más cercanos', () => {
    const predios = [1, 2, 3, 4, 30].map((km, i) => ({ nombre: `P${i}`, tipo: 'Estancia', ...alNorte(20 + km) }));
    const r = motor.evaluar(alNorte(20), [concepcion], predios);
    expect(r.factores.prediosExcluidos.map((p) => p.nombre)).toEqual(['P0', 'P1', 'P2']);
  });

  it('Bajo y sin comunidad si el catálogo está vacío', () => {
    const r = motor.evaluar({ latitud: -16, longitud: -62 }, []);
    expect(r).toMatchObject({ nivel: NivelRiesgo.Bajo, comunidadId: null, distanciaKm: null });
    expect(r.factores).toMatchObject({ regla: 'CatalogoVacio', comunidadMasCercana: null });
  });

  it('RNF-04: evalúa 60 focos activos contra 2.000 comunidades y 2.000 estancias en <5 s', () => {
    const catalogo = (prefijo: string) =>
      Array.from({ length: 2000 }, (_, i) => ({
        id: `${prefijo}${i}`,
        nombre: `${prefijo} ${i}`,
        tipo: 'Estancia',
        latitud: -14 - (i % 60) * 0.1,
        longitud: -58 - Math.floor(i / 60) * 0.1,
      }));
    const comunidades = catalogo('c');
    const predios = catalogo('p');
    const inicio = performance.now();
    for (let f = 0; f < 60; f++) motor.evaluar({ latitud: -15 - f * 0.05, longitud: -60 }, comunidades, predios);
    expect(performance.now() - inicio).toBeLessThan(5000);
  });
});
