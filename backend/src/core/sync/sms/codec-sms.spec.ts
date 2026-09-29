import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Rumbo } from '../../reporte/enums/rumbo.enum';
import {
  codificarReporte,
  cortoAUuid,
  decodificarReporte,
  ErrorSms,
  LARGO_MAXIMO_SMS,
  ReporteSms,
  smsPlano,
  uuidACorto,
} from './codec-sms';

// Codificador de la app (frontend/app/js/sms.js): debe producir exactamente el mismo texto.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const smsApp = require(join(__dirname, '../../../../../frontend/app/js/sms.js'));

describe('codec SMS BRC1 (HU-1.3, RNF-02)', () => {
  const fecha = new Date('2026-09-29T14:03:27Z');
  const gps: ReporteSms = { tipo: 'G', id: randomUUID(), latitud: -16.115312, longitud: -62.025845, precisionMetros: 8.4, fecha };
  const distancia: ReporteSms = { tipo: 'D', id: randomUUID(), comunidadId: randomUUID(), rumbo: Rumbo.O, distanciaKm: 12.36, fecha };

  it('UUID ↔ 22 caracteres base64url', () => {
    const id = randomUUID();
    expect(uuidACorto(id)).toHaveLength(22);
    expect(cortoAUuid(uuidACorto(id))).toBe(id);
    expect(() => cortoAUuid('corto')).toThrow(ErrorSms);
  });

  it('codifica y decodifica sin pérdida relevante, en ≤160 caracteres', () => {
    const texto = codificarReporte(gps);
    expect(texto).toMatch(/^BRC1 G [A-Za-z0-9_-]{22} -16\.11531 -62\.02584 8 [0-9a-z]+$/);
    expect(texto.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
    expect(decodificarReporte(texto)).toEqual({ ...gps, latitud: -16.11531, longitud: -62.02584, precisionMetros: 8 });

    const textoD = codificarReporte(distancia);
    expect(textoD.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
    expect(decodificarReporte(textoD)).toEqual({ ...distancia, distanciaKm: 12.4 });
  });

  it('tolera espacios extra y minúsculas del teclado', () => {
    const texto = codificarReporte(distancia).replace('BRC1 D', ' brc1   d ').replace(' O ', ' o ');
    expect(decodificarReporte(texto)).toMatchObject({ tipo: 'D', rumbo: 'O' });
  });

  it('rechaza textos que no son un reporte válido', () => {
    for (const malo of ['hola', 'BRC1', 'BRC1 X a b c d e', 'BRC1 G corto 1 2 3 4', `BRC1 D ${uuidACorto(randomUUID())} ${uuidACorto(randomUUID())} NE 3 abc`]) {
      expect(() => decodificarReporte(malo)).toThrow(ErrorSms);
    }
    expect(() => decodificarReporte(`BRC1 G ${uuidACorto(randomUUID())} lat -62 8 abc`)).toThrow(/latitud/);
  });

  it('el codificador de la app produce exactamente el mismo SMS que el backend', () => {
    for (let i = 0; i < 50; i++) {
      const r: ReporteSms =
        i % 2
          ? { ...gps, id: randomUUID(), latitud: -15 - Math.random() * 4, longitud: -58 - Math.random() * 6, precisionMetros: Math.random() * 15 }
          : { ...distancia, id: randomUUID(), comunidadId: randomUUID(), distanciaKm: 0.1 + Math.random() * 49.9 };
      expect(smsApp.codificarReporte(r)).toBe(codificarReporte(r));
    }
  });

  it('Bolt 5: la bitácora de turno cabe en un SMS (≈80 caracteres) y se decodifica igual', () => {
    const bitacora: ReporteSms = {
      tipo: 'B',
      incidenteId: randomUUID(),
      id: randomUUID(),
      aguaSuficiente: false,
      combustibleOk: true,
      herramientasOperativas: true,
      kmFajaMitigados: 12.34,
      porcentajeControl: 70,
      fecha,
    };
    const texto = codificarReporte(bitacora);
    expect(texto).toMatch(/^BRC1 B [\w-]{22} [\w-]{22} C O 1 12\.3 70 [0-9a-z]+$/);
    expect(texto.length).toBeLessThanOrEqual(90);
    expect(decodificarReporte(texto)).toEqual({ ...bitacora, kmFajaMitigados: 12.3 });
    expect(decodificarReporte(texto.replace(' C O 1 ', ' c o 1 '))).toMatchObject({ aguaSuficiente: false, combustibleOk: true });
    expect(() => decodificarReporte(texto.replace(' C O 1 ', ' X O 1 '))).toThrow(/agua/);
    expect(() => decodificarReporte(texto.replace(' C O 1 ', ' C O 2 '))).toThrow(/herramientas/);
    for (let i = 0; i < 20; i++) {
      const r = { ...bitacora, id: randomUUID(), kmFajaMitigados: Math.random() * 50, porcentajeControl: Math.round(Math.random() * 100), aguaSuficiente: i % 2 === 0 };
      expect(smsApp.codificarReporte(r)).toBe(codificarReporte(r));
    }
  });

  it('las respuestas salientes caben en un solo segmento GSM-7', () => {
    const plano = smsPlano('BRC1 OK 1234abcd Riesgo Alto (San José de Chiquitos). Contacto: Ñusta Peñaranda ΔT'.repeat(3));
    expect(plano.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
    expect(plano).toMatch(/^[\x20-\x7e]+$/);
    expect(plano).toContain('San Jose de Chiquitos');
  });
});
