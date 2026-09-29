import { createECDH, createPublicKey, verify } from 'node:crypto';
import { descifrarMensaje } from '../../../../test/push-falso';
import { cabeceraVapid, cifrarMensaje, endpointPermitido, generarClavesVapid, validarClavesVapid } from './web-push';

/** RFC 8291, apéndice A: vector de prueba oficial del cifrado de Web Push. */
const RFC = {
  mensaje: 'When I grow up, I want to be a watermelon',
  asPrivada: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivada: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublica: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  cuerpo:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('Web Push sin librerías (Bolt 4, RF-11)', () => {
  it('RFC 8291 apéndice A: el cuerpo cifrado coincide byte a byte con el vector oficial', () => {
    const cuerpo = cifrarMensaje(
      Buffer.from(RFC.mensaje),
      { p256dh: RFC.uaPublica, auth: RFC.auth },
      { efimeraPrivada: Buffer.from(RFC.asPrivada, 'base64url'), salt: Buffer.from(RFC.salt, 'base64url') },
    );
    expect(cuerpo.toString('base64url')).toBe(RFC.cuerpo);
  });

  it('ida y vuelta: el navegador descifra lo que cifra la API (con claves y salt aleatorios)', () => {
    const ua = createECDH('prime256v1');
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const cuerpo = cifrarMensaje(Buffer.from('{"titulo":"Despacho FOCO-1"}'), {
      p256dh: ua.getPublicKey().toString('base64url'),
      auth: auth.toString('base64url'),
    });
    expect(descifrarMensaje(cuerpo, ua.getPrivateKey(), auth)).toBe('{"titulo":"Despacho FOCO-1"}');
  });

  it('VAPID: JWT ES256 verificable con la clave pública, audiencia = origen del endpoint', () => {
    const claves = generarClavesVapid('mailto:coed@example.org');
    expect(() => validarClavesVapid(claves)).not.toThrow();
    const cabecera = cabeceraVapid('https://fcm.googleapis.com/fcm/send/abc', claves, Date.UTC(2026, 8, 29));
    const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(cabecera)!;
    expect(k).toBe(claves.publica);
    const [h, c, f] = jwt.split('.');
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Date.UTC(2026, 8, 29) / 1000 + 12 * 3600,
      sub: 'mailto:coed@example.org',
    });
    const publica = Buffer.from(claves.publica, 'base64url');
    const clave = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: publica.subarray(1, 33).toString('base64url'), y: publica.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key: clave, dsaEncoding: 'ieee-p1363' }, Buffer.from(f, 'base64url'))).toBe(true);
  });

  it('rechaza claves VAPID que no forman un par', () => {
    const a = generarClavesVapid('mailto:a@b.c');
    const b = generarClavesVapid('mailto:a@b.c');
    expect(() => validarClavesVapid({ ...a, publica: b.publica })).toThrow(/no corresponde/);
  });

  it('SSRF: en producción solo servicios de push conocidos por https', () => {
    expect(endpointPermitido('https://fcm.googleapis.com/fcm/send/x', true)).toBe(true);
    expect(endpointPermitido('https://updates.push.services.mozilla.com/wpush/v2/x', true)).toBe(true);
    expect(endpointPermitido('https://db.notify.windows.com/w/?token=x', true)).toBe(true);
    expect(endpointPermitido('https://evil.example.com/fcm.googleapis.com', true)).toBe(false);
    expect(endpointPermitido('https://fcm.googleapis.com.evil.com/x', true)).toBe(false);
    expect(endpointPermitido('http://127.0.0.1:9999/push', true)).toBe(false);
    expect(endpointPermitido('http://127.0.0.1:9999/push', false)).toBe(true);
    expect(endpointPermitido('http://169.254.169.254/latest', false)).toBe(false);
    expect(endpointPermitido('no es url', false)).toBe(false);
  });
});
