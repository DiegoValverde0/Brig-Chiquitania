import { BadRequestException } from '@nestjs/common';
import { fechaDelCliente } from './validacion';

describe('fechaDelCliente', () => {
  const ahora = new Date('2026-09-28T12:00:00Z');

  it('usa la hora del servidor si el cliente no envía fecha', () => {
    expect(fechaDelCliente(undefined, 'f', ahora)).toBe(ahora);
  });

  it('acepta una fecha pasada (reporte capturado offline)', () => {
    expect(fechaDelCliente('2026-09-28T10:00:00Z', 'f', ahora).toISOString()).toBe('2026-09-28T10:00:00.000Z');
  });

  it('rechaza fechas futuras más allá de la tolerancia de reloj y textos inválidos', () => {
    expect(() => fechaDelCliente('2026-09-28T12:10:00Z', 'f', ahora)).toThrow(BadRequestException);
    expect(() => fechaDelCliente('ayer', 'f', ahora)).toThrow(BadRequestException);
  });
});
