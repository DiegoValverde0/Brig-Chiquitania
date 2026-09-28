import { NivelRiesgo } from './enums/nivel-riesgo.enum';
import { JUSTIFICACION_ALTO, MotorRiesgoService } from './motor-riesgo.service';

describe('MotorRiesgoService (regla única del Bolt 0)', () => {
  const motor = new MotorRiesgoService();
  const concepcion = { id: 'c1', nombre: 'Concepción', latitud: -16.1333, longitud: -62.0258 };
  const sanJavier = { id: 'c2', nombre: 'San Javier', latitud: -16.2747, longitud: -62.5064 };

  it('Alto si hay una comunidad habitada a <5 km, con justificación visible', () => {
    const r = motor.evaluar({ latitud: -16.1153, longitud: -62.0258 }, [sanJavier, concepcion]);
    expect(r.nivel).toBe(NivelRiesgo.Alto);
    expect(r.justificacion.startsWith(JUSTIFICACION_ALTO)).toBe(true);
    expect(r.comunidadId).toBe('c1');
    expect(r.distanciaKm).toBeCloseTo(2, 0);
  });

  it('Bajo si la comunidad más cercana está a ≥5 km, pero la asocia igual (contacto comunal)', () => {
    const r = motor.evaluar({ latitud: -16.0333, longitud: -62.0258 }, [concepcion, sanJavier]);
    expect(r.nivel).toBe(NivelRiesgo.Bajo);
    expect(r.comunidadId).toBe('c1');
  });

  it('Bajo y sin comunidad si el catálogo está vacío', () => {
    const r = motor.evaluar({ latitud: -16, longitud: -62 }, []);
    expect(r).toMatchObject({ nivel: NivelRiesgo.Bajo, comunidadId: null });
  });

  it('RNF-04: evalúa 60 focos activos contra 2.000 comunidades en <5 s', () => {
    const comunidades = Array.from({ length: 2000 }, (_, i) => ({
      id: `c${i}`,
      nombre: `Comunidad ${i}`,
      latitud: -14 - (i % 60) * 0.1,
      longitud: -58 - Math.floor(i / 60) * 0.1,
    }));
    const inicio = performance.now();
    for (let f = 0; f < 60; f++) motor.evaluar({ latitud: -15 - f * 0.05, longitud: -60 }, comunidades);
    expect(performance.now() - inicio).toBeLessThan(5000);
  });
});
