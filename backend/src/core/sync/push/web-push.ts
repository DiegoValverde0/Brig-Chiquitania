import { createECDH, createHmac, createPrivateKey, createCipheriv, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

/**
 * Web Push estándar sin librerías (Bolt 4, RF-11), con `node:crypto` como el cifrado y el SMS:
 * - cifrado del mensaje `aes128gcm` (RFC 8188 + RFC 8291: ECDH P-256 + HKDF-SHA-256 + AES-128-GCM);
 * - identificación del servidor con VAPID (RFC 8292: JWT ES256).
 * Funciones puras salvo `enviarPush` (fetch al servicio de push del navegador del jefe de brigada).
 */

export interface SuscripcionWebPush {
  endpoint: string;
  /** Clave pública P-256 del navegador (65 bytes sin comprimir, base64url). */
  p256dh: string;
  /** Secreto de autenticación del navegador (16 bytes, base64url). */
  auth: string;
}

export interface ClavesVapid {
  /** Clave pública P-256 sin comprimir (65 bytes, base64url): la que usa `pushManager.subscribe`. */
  publica: string;
  /** Escalar privado (32 bytes, base64url). */
  privada: string;
  /** Contacto del operador para el servicio de push (`mailto:` o `https:`). */
  contacto: string;
}

const b64u = (b: Buffer): string => b.toString('base64url');
const desdeB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

function hmac(clave: Buffer, datos: Buffer): Buffer {
  return createHmac('sha256', clave).update(datos).digest();
}

/** Genera un par de claves VAPID nuevo. */
export function generarClavesVapid(contacto: string): ClavesVapid {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publica = Buffer.concat([Buffer.from([4]), desdeB64u(jwk.x!), desdeB64u(jwk.y!)]);
  return { publica: b64u(publica), privada: jwk.d!, contacto };
}

/** Valida que las claves VAPID sean un par P-256 coherente (falla al arrancar, no al primer despacho). */
export function validarClavesVapid(claves: ClavesVapid): void {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(desdeB64u(claves.privada));
  if (!ecdh.getPublicKey().equals(desdeB64u(claves.publica))) {
    throw new Error('VAPID_PUBLICA no corresponde a VAPID_PRIVADA');
  }
  if (!/^(mailto:|https:)/.test(claves.contacto)) throw new Error('VAPID_CONTACTO debe empezar con mailto: o https:');
}

/**
 * RFC 8291 §3.4 + RFC 8188: cuerpo cifrado de un solo registro. `efimera` y `salt` solo se fijan en las pruebas
 * (vector del apéndice A); en producción son aleatorios en cada mensaje.
 */
export function cifrarMensaje(
  mensaje: Buffer,
  suscripcion: Pick<SuscripcionWebPush, 'p256dh' | 'auth'>,
  opciones: { efimeraPrivada?: Buffer; salt?: Buffer } = {},
): Buffer {
  const uaPublica = desdeB64u(suscripcion.p256dh);
  const secretoAuth = desdeB64u(suscripcion.auth);
  if (uaPublica.length !== 65 || uaPublica[0] !== 4) throw new Error('p256dh inválida');
  if (secretoAuth.length !== 16) throw new Error('auth inválido');

  const as = createECDH('prime256v1');
  if (opciones.efimeraPrivada) as.setPrivateKey(opciones.efimeraPrivada);
  else as.generateKeys();
  const asPublica = as.getPublicKey();
  const secretoEcdh = as.computeSecret(uaPublica);
  const salt = opciones.salt ?? randomBytes(16);

  // HKDF (RFC 5869) en su forma de un solo bloque: todas las salidas miden ≤32 bytes.
  const prkClave = hmac(secretoAuth, secretoEcdh);
  const infoClave = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica, Buffer.from([1])]);
  const ikm = hmac(prkClave, infoClave);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  const cifrador = createCipheriv('aes-128-gcm', cek, nonce);
  // Delimitador 0x02: último (y único) registro, sin relleno.
  const cifrado = Buffer.concat([cifrador.update(Buffer.concat([mensaje, Buffer.from([2])])), cifrador.final()]);
  const cabecera = Buffer.alloc(21);
  salt.copy(cabecera, 0);
  cabecera.writeUInt32BE(4096, 16); // tamaño de registro
  cabecera.writeUInt8(asPublica.length, 20);
  return Buffer.concat([cabecera, asPublica, cifrado, cifrador.getAuthTag()]);
}

/** RFC 8292: cabecera `Authorization: vapid t=<JWT ES256>, k=<clave pública>` para el origen del endpoint. */
export function cabeceraVapid(endpoint: string, claves: ClavesVapid, ahora = Date.now()): string {
  const publica = desdeB64u(claves.publica);
  const aud = new URL(endpoint).origin;
  const cabecera = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const reclamos = b64u(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: claves.contacto })),
  );
  const clave = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: claves.privada,
      x: b64u(publica.subarray(1, 33)),
      y: b64u(publica.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const firma = sign('sha256', Buffer.from(`${cabecera}.${reclamos}`), { key: clave, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cabecera}.${reclamos}.${b64u(firma)}, k=${claves.publica}`;
}

/** Servicios de push de los navegadores (defensa contra SSRF: la API solo llama a estos hosts en producción). */
const HOSTS_PUSH = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];

/** Endpoint aceptable: https a un servicio de push conocido; fuera de producción también http a localhost (pruebas). */
export function endpointPermitido(endpoint: string, produccion: boolean): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol === 'https:' && HOSTS_PUSH.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    return true;
  }
  return !produccion && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
}

export type ResultadoPush = { ok: true } | { ok: false; vencida: boolean; detalle: string };

/** Envía un mensaje cifrado al servicio de push. 404/410 = suscripción vencida (se debe borrar). */
export async function enviarPush(
  suscripcion: SuscripcionWebPush,
  mensaje: Buffer,
  claves: ClavesVapid,
  tiempoLimiteMs = 10000,
): Promise<ResultadoPush> {
  const cuerpo = cifrarMensaje(mensaje, suscripcion);
  try {
    const res = await fetch(suscripcion.endpoint, {
      method: 'POST',
      headers: {
        Authorization: cabeceraVapid(suscripcion.endpoint, claves),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'high',
      },
      body: new Uint8Array(cuerpo),
      signal: AbortSignal.timeout(tiempoLimiteMs),
    });
    if (res.ok) return { ok: true };
    return { ok: false, vencida: res.status === 404 || res.status === 410, detalle: `Servicio de push: HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, vencida: false, detalle: `Servicio de push inalcanzable: ${(error as Error).message}` };
  }
}
