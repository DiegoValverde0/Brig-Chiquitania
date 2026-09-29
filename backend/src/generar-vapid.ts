import { generarClavesVapid } from './core/sync/push/web-push';

/**
 * Genera las claves VAPID de Web Push (Bolt 4) para el .env del VPS. Se generan UNA vez: si cambian, los
 * navegadores de los jefes de brigada deben volver a suscribirse (abrir "Mi brigada").
 *
 *   node dist/generar-vapid mailto:coed@ejemplo.bo
 *   (en Docker: docker compose exec api node dist/generar-vapid mailto:coed@ejemplo.bo)
 */
const contacto = process.argv[2] ?? 'mailto:coed@example.org';
const claves = generarClavesVapid(contacto);
console.log(`VAPID_PUBLICA=${claves.publica}`);
console.log(`VAPID_PRIVADA=${claves.privada}`);
console.log(`VAPID_CONTACTO=${claves.contacto}`);
