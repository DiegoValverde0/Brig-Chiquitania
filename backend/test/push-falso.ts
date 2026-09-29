import { createDecipheriv, createECDH, createHmac } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';

/** Descifrado independiente (lado del navegador) para las pruebas de ida y vuelta. */
export function descifrarMensaje(cuerpo: Buffer, uaPrivada: Buffer, auth: Buffer): string {
  const salt = cuerpo.subarray(0, 16);
  const largoClave = cuerpo[20];
  const asPublica = cuerpo.subarray(21, 21 + largoClave);
  const cifrado = cuerpo.subarray(21 + largoClave);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivada);
  const h = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
  const ikm = h(
    h(auth, ua.computeSecret(asPublica)),
    Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublica, Buffer.from([1])]),
  );
  const prk = h(salt, ikm);
  const cek = h(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = h(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const plano = Buffer.concat([d.update(cifrado.subarray(0, cifrado.length - 16)), d.final()]);
  return plano.subarray(0, plano.lastIndexOf(2)).toString();
}


export interface PushRecibido {
  ruta: string;
  autorizacion: string;
  codificacion: string;
  mensaje: string;
}

/**
 * Servicio de push falso (como FCM, pero local): recibe los POST de la API, descifra el mensaje con la clave del
 * "navegador" de la prueba y lo guarda. `respuesta` fija el código HTTP (p. ej. 410 = suscripción vencida).
 */
export class PushFalso {
  readonly navegador = createECDH('prime256v1');
  readonly auth = Buffer.alloc(16, 9);
  readonly recibidos: PushRecibido[] = [];
  respuesta = 201;
  private servidor: Server | null = null;
  private puerto = 0;

  constructor() {
    this.navegador.generateKeys();
  }

  async iniciar(): Promise<void> {
    this.servidor = createServer((req: IncomingMessage, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d: Buffer) => partes.push(d));
      req.on('end', () => {
        if (this.respuesta < 300) {
          this.recibidos.push({
            ruta: req.url ?? '',
            autorizacion: String(req.headers.authorization ?? ''),
            codificacion: String(req.headers['content-encoding'] ?? ''),
            mensaje: descifrarMensaje(Buffer.concat(partes), this.navegador.getPrivateKey(), this.auth),
          });
        }
        res.statusCode = this.respuesta;
        res.end();
      });
    });
    await new Promise<void>((r) => this.servidor!.listen(0, '127.0.0.1', r));
    this.puerto = (this.servidor.address() as AddressInfo).port;
  }

  /** Suscripción como la que enviaría el navegador del jefe de brigada. */
  suscripcion(nombre = 'jefe') {
    return {
      endpoint: `http://127.0.0.1:${this.puerto}/push/${nombre}`,
      keys: { p256dh: this.navegador.getPublicKey().toString('base64url'), auth: this.auth.toString('base64url') },
    };
  }

  async detener(): Promise<void> {
    await new Promise<void>((r) => (this.servidor ? this.servidor.close(() => r()) : r()));
  }
}
