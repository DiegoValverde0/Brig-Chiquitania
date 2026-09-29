import { randomBytes } from 'node:crypto';
import {
  cifrarBytes,
  cifrarTexto,
  descifrarBytes,
  descifrarTexto,
  esTextoCifrado,
  numeroCifrado,
  reiniciarClaveCifrado,
} from './cifrado';

describe('cifrado AES-256-GCM (RNF-08)', () => {
  afterEach(() => {
    delete process.env.CLAVE_CIFRADO;
    reiniciarClaveCifrado();
  });

  it('cifra y descifra texto; dos cifrados del mismo valor difieren (IV aleatorio)', () => {
    const a = cifrarTexto('+59170000100');
    const b = cifrarTexto('+59170000100');
    expect(a).not.toBe(b);
    expect(esTextoCifrado(a)).toBe(true);
    expect(a).not.toContain('70000100');
    expect(descifrarTexto(a)).toBe('+59170000100');
  });

  it('detecta la manipulación del texto cifrado (integridad GCM)', () => {
    const [v, iv, tag, cuerpo] = cifrarTexto('Referente comunal').split(':');
    const alterado = Buffer.from(cuerpo, 'base64url');
    alterado[0] ^= 1;
    expect(() => descifrarTexto([v, iv, tag, alterado.toString('base64url')].join(':'))).toThrow();
  });

  it('cifra binarios (fotos) y números (coordenadas) sin pérdida', () => {
    const foto = randomBytes(2048);
    expect(descifrarBytes(cifrarBytes(foto)).equals(foto)).toBe(true);
    const guardado = numeroCifrado.to(-16.115312);
    expect(numeroCifrado.from(guardado)).toBe(-16.115312);
    expect(numeroCifrado.to(null)).toBeNull();
  });

  it('con otra clave no se puede descifrar', () => {
    const cifrado = cifrarTexto('secreto');
    process.env.CLAVE_CIFRADO = randomBytes(32).toString('base64');
    reiniciarClaveCifrado();
    expect(() => descifrarTexto(cifrado)).toThrow();
  });

  it('exige una clave de 32 bytes y la exige en producción', () => {
    process.env.CLAVE_CIFRADO = Buffer.from('corta').toString('base64');
    reiniciarClaveCifrado();
    expect(() => cifrarTexto('x')).toThrow(/32 bytes/);
    delete process.env.CLAVE_CIFRADO;
    reiniciarClaveCifrado();
    const entorno = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => cifrarTexto('x')).toThrow(/obligatoria/);
    } finally {
      process.env.NODE_ENV = entorno;
    }
  });
});
