import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { distanciaKm, puntoDestino } from './geo';

describe('distanciaKm (haversine)', () => {
  it('un grado de latitud mide ~111,2 km', () => {
    expect(distanciaKm({ latitud: 0, longitud: 0 }, { latitud: 1, longitud: 0 })).toBeCloseTo(111.19, 1);
  });

  it('es simétrica y nula sobre el mismo punto', () => {
    const a = { latitud: -16.1333, longitud: -62.0258 };
    const b = { latitud: -17.7833, longitud: -63.1821 };
    expect(distanciaKm(a, b)).toBeCloseTo(distanciaKm(b, a), 9);
    expect(distanciaKm(a, a)).toBe(0);
  });
});

describe('puntoDestino (HU-1.2: comunidad + rumbo + distancia)', () => {
  const concepcion = { latitud: -16.1333, longitud: -62.0258 };

  it.each([
    [0, 'N'],
    [90, 'E'],
    [180, 'S'],
    [270, 'O'],
  ])('a %i° (%s) el punto queda a la distancia pedida', (grados) => {
    const destino = puntoDestino(concepcion, grados, 7.5);
    expect(distanciaKm(concepcion, destino)).toBeCloseTo(7.5, 2);
  });

  it('respeta la dirección cardinal', () => {
    expect(puntoDestino(concepcion, 0, 3).latitud).toBeGreaterThan(concepcion.latitud);
    expect(puntoDestino(concepcion, 180, 3).latitud).toBeLessThan(concepcion.latitud);
    expect(puntoDestino(concepcion, 90, 3).longitud).toBeGreaterThan(concepcion.longitud);
    expect(puntoDestino(concepcion, 270, 3).longitud).toBeLessThan(concepcion.longitud);
  });

  it('coincide con el cálculo de la app (frontend/app/js/geo.js), que autocompleta el contacto offline', () => {
    const contexto: { self: { BrcGeo?: { puntoDestino: typeof puntoDestino; distanciaKm: typeof distanciaKm } } } = { self: {} };
    runInNewContext(readFileSync(join(__dirname, '../../../frontend/app/js/geo.js'), 'utf8'), contexto);
    const app = contexto.self.BrcGeo!;
    const rumbos: Array<[string, number]> = [['N', 0], ['E', 90], ['S', 180], ['O', 270]];
    for (const [letra, grados] of rumbos) {
      for (const km of [0.1, 3, 12.5, 50]) {
        expect(app.puntoDestino(concepcion, letra as never, km)).toEqual(puntoDestino(concepcion, grados, km));
      }
    }
    const b = { latitud: -17.7833, longitud: -63.1821 };
    expect(app.distanciaKm(concepcion, b)).toBe(distanciaKm(concepcion, b));
  });
});
