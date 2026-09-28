import { distanciaKm } from './geo';

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
