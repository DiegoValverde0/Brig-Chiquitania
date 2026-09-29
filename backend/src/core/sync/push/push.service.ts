import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { exigirObjeto, exigirTexto } from '../../../common/validacion';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { SuscripcionPush } from './suscripcion-push.entity';
import { ClavesVapid, endpointPermitido, enviarPush, generarClavesVapid, validarClavesVapid } from './web-push';

const B64U = /^[A-Za-z0-9_-]+$/;

export interface ResultadoEnvioPush {
  /** Cuántos dispositivos del usuario aceptaron el mensaje. */
  enviados: number;
  /** Suscripciones intentadas (0 = el usuario no tiene ninguna: hay que usar SMS). */
  intentos: number;
  detalle: string | null;
}

/**
 * Canal Web Push (MT-1, Bolt 4): claves VAPID, suscripciones de los navegadores y envío cifrado.
 * Claves: `VAPID_PUBLICA`, `VAPID_PRIVADA` y `VAPID_CONTACTO` (obligatorias en producción). En desarrollo se
 * generan una vez y se guardan junto al almacén de archivos (`vapid-dev.json`) para que las suscripciones sigan
 * valiendo tras reiniciar.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  readonly claves: ClavesVapid;
  private readonly produccion = process.env.NODE_ENV === 'production';

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    const publica = config.get<string>('VAPID_PUBLICA');
    const privada = config.get<string>('VAPID_PRIVADA');
    const contacto = config.get<string>('VAPID_CONTACTO') ?? 'mailto:coed@example.org';
    if (publica && privada) {
      this.claves = { publica, privada, contacto };
    } else if (this.produccion) {
      throw new Error('VAPID_PUBLICA y VAPID_PRIVADA son obligatorias en producción (Web Push, Bolt 4)');
    } else {
      this.claves = clavesDeDesarrollo(config.get<string>('EVIDENCIAS_DIR', 'almacen/evidencias'), contacto);
    }
    validarClavesVapid(this.claves);
  }

  /** Guarda (o renueva) la suscripción del navegador del usuario. Idempotente por endpoint. */
  async suscribir(usuario: Usuario, body: unknown): Promise<{ suscrito: true }> {
    const datos = exigirObjeto(body);
    const endpoint = exigirTexto(datos.endpoint, 'endpoint', 1000);
    const claves = exigirObjeto(datos.keys);
    const p256dh = exigirTexto(claves.p256dh, 'keys.p256dh', 100);
    const auth = exigirTexto(claves.auth, 'keys.auth', 40);
    if (!endpointPermitido(endpoint, this.produccion)) {
      throw new BadRequestException('El endpoint no es de un servicio de push reconocido (https)');
    }
    if (!B64U.test(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65) {
      throw new BadRequestException('keys.p256dh inválida');
    }
    if (!B64U.test(auth) || Buffer.from(auth, 'base64url').length !== 16) {
      throw new BadRequestException('keys.auth inválida');
    }
    await this.dataSource
      .getRepository(SuscripcionPush)
      .upsert({ usuario: { id: usuario.id }, endpoint, endpointHash: hash(endpoint), p256dh, auth }, ['endpointHash']);
    return { suscrito: true };
  }

  async desuscribir(usuario: Usuario, body: unknown): Promise<{ suscrito: false }> {
    const endpoint = exigirTexto(exigirObjeto(body).endpoint, 'endpoint', 1000);
    await this.dataSource
      .getRepository(SuscripcionPush)
      .delete({ endpointHash: hash(endpoint), usuario: { id: usuario.id } });
    return { suscrito: false };
  }

  /** Envía el mensaje a todos los dispositivos del usuario; borra las suscripciones vencidas (404/410). */
  async enviar(usuarioId: string, mensaje: object): Promise<ResultadoEnvioPush> {
    const repo = this.dataSource.getRepository(SuscripcionPush);
    const suscripciones = await repo.findBy({ usuario: { id: usuarioId } });
    let enviados = 0;
    let detalle: string | null = null;
    for (const s of suscripciones) {
      if (!endpointPermitido(s.endpoint, this.produccion)) {
        detalle = 'Endpoint no permitido';
        continue;
      }
      const r = await enviarPush(s, Buffer.from(JSON.stringify(mensaje)), this.claves);
      if (r.ok) {
        enviados++;
      } else {
        detalle = r.detalle;
        if (r.vencida) await repo.delete({ id: s.id });
        this.log.warn(`Push fallido: ${r.detalle}`);
      }
    }
    return { enviados, intentos: suscripciones.length, detalle };
  }
}

function hash(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex');
}

function clavesDeDesarrollo(dirEvidencias: string, contacto: string): ClavesVapid {
  const archivo = join(dirname(resolve(dirEvidencias)), 'vapid-dev.json');
  if (existsSync(archivo)) return { ...(JSON.parse(readFileSync(archivo, 'utf8')) as ClavesVapid), contacto };
  const claves = generarClavesVapid(contacto);
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, JSON.stringify(claves), { mode: 0o600 });
  return claves;
}
