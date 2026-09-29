import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { leerBitacora, PESO_MAXIMO_BITACORA } from './bitacora';

describe('Bitácora de turno: checklist (HU-5.2, RF-12, RS-02)', () => {
  const base = {
    id: randomUUID(),
    fecha: '2026-09-29T15:00:00Z',
    nivelAgua: 'Critica',
    nivelCombustible: 'OK',
    herramientasOperativas: true,
    kmFajaMitigados: 2.37,
    porcentajeControl: 40,
  };

  it('acepta el checklist del UML y redondea los km a un decimal', () => {
    expect(leerBitacora(base)).toMatchObject({ nivelAgua: 'Critica', kmFajaMitigados: 2.4, porcentajeControl: 40 });
  });

  it('RS-02: el paquete JSON de una bitácora pesa bastante menos de 1 KB', () => {
    expect(Buffer.byteLength(JSON.stringify(base))).toBeLessThan(PESO_MAXIMO_BITACORA / 3);
  });

  it('nunca texto libre: rechaza cualquier campo que no sea del checklist', () => {
    expect(() => leerBitacora({ ...base, descripcion: 'todo bien' })).toThrow(/checklist: campo no permitido \(descripcion\)/);
    expect(() => leerBitacora({ ...base, observaciones: 'x' })).toThrow(BadRequestException);
  });

  it('valida valores, rangos y tipos', () => {
    const malos: object[] = [
      { nivelAgua: 'Baja' },
      { nivelCombustible: 'Lleno' },
      { herramientasOperativas: 'si' },
      { kmFajaMitigados: -1 },
      { kmFajaMitigados: 501 },
      { porcentajeControl: 101 },
      { porcentajeControl: 50.5 },
      { id: 'no-uuid' },
      { fecha: '2099-01-01T00:00:00Z' },
    ];
    for (const m of malos) expect(() => leerBitacora({ ...base, ...m })).toThrow(BadRequestException);
  });

  it('sin fecha usa la hora del servidor', () => {
    const ahora = new Date('2026-09-29T16:00:00Z');
    const { fecha, ...sinFecha } = base;
    void fecha;
    expect(leerBitacora(sinFecha, ahora).fecha).toEqual(ahora);
  });
});
