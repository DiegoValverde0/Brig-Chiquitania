import { Rumbo } from '../../reporte/enums/rumbo.enum';

/**
 * Formato compacto del reporte por SMS (HU-1.3, RNF-02): texto plano ASCII de 160 caracteres o menos, apto
 * para 2G. Versionado con el prefijo `BRC1`.
 *
 *   GPS:       BRC1 G <id> <lat> <lon> <precisión m> <hora>
 *   Distancia: BRC1 D <id> <comunidad> <rumbo N|S|E|O> <km> <hora>
 *
 * - <id> y <comunidad>: UUID en base64url (22 caracteres). El <id> es el mismo UUID que genera la app, así el
 *   reporte que llega por SMS y luego por datos no se duplica (RNF-01).
 * - <lat>/<lon>: grados decimales con 5 decimales (~1 m).
 * - <hora>: segundos Unix en base 36 (momento de captura en el dispositivo).
 *
 * La app (frontend/js/sms.js) implementa el mismo codificador; una prueba verifica que ambos coinciden.
 */
export const PREFIJO_SMS = 'BRC1';
export const LARGO_MAXIMO_SMS = 160;

export type ReporteSms =
  | { tipo: 'G'; id: string; latitud: number; longitud: number; precisionMetros: number; fecha: Date }
  | { tipo: 'D'; id: string; comunidadId: string; rumbo: Rumbo; distanciaKm: number; fecha: Date };

export class ErrorSms extends Error {}

export function uuidACorto(uuid: string): string {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url');
}

export function cortoAUuid(corto: string): string {
  const hex = Buffer.from(corto, 'base64url').toString('hex');
  if (!/^[0-9a-f]{32}$/.test(hex) || corto.length !== 22) throw new ErrorSms('Identificador inválido');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const numero = (valor: number, decimales: number): string => String(Number(valor.toFixed(decimales)));

export function codificarReporte(r: ReporteSms): string {
  const hora = Math.floor(r.fecha.getTime() / 1000).toString(36);
  const partes =
    r.tipo === 'G'
      ? [PREFIJO_SMS, 'G', uuidACorto(r.id), numero(r.latitud, 5), numero(r.longitud, 5), String(Math.round(r.precisionMetros)), hora]
      : [PREFIJO_SMS, 'D', uuidACorto(r.id), uuidACorto(r.comunidadId), r.rumbo, numero(r.distanciaKm, 1), hora];
  const texto = partes.join(' ');
  if (texto.length > LARGO_MAXIMO_SMS) throw new ErrorSms('El SMS supera los 160 caracteres');
  return texto;
}

const NUMERO = /^-?\d+(\.\d+)?$/;

function leerNumero(valor: string, campo: string): number {
  if (!NUMERO.test(valor)) throw new ErrorSms(`${campo} inválido`);
  return Number(valor);
}

function leerHora(valor: string): Date {
  if (!/^[0-9a-z]{1,8}$/.test(valor)) throw new ErrorSms('hora inválida');
  return new Date(parseInt(valor, 36) * 1000);
}

/** Decodifica un SMS entrante. Tolera espacios extra y minúsculas en el prefijo (teclados de campo). */
export function decodificarReporte(texto: string): ReporteSms {
  if (texto.length > LARGO_MAXIMO_SMS) throw new ErrorSms('SMS demasiado largo');
  const partes = texto.trim().split(/\s+/);
  if (partes[0]?.toUpperCase() !== PREFIJO_SMS) throw new ErrorSms(`El SMS no empieza con ${PREFIJO_SMS}`);
  const tipo = partes[1]?.toUpperCase();
  if (tipo === 'G' && partes.length === 7) {
    return {
      tipo: 'G',
      id: cortoAUuid(partes[2]),
      latitud: leerNumero(partes[3], 'latitud'),
      longitud: leerNumero(partes[4], 'longitud'),
      precisionMetros: leerNumero(partes[5], 'precisión'),
      fecha: leerHora(partes[6]),
    };
  }
  if (tipo === 'D' && partes.length === 7) {
    const rumbo = partes[4].toUpperCase();
    if (!(Object.values(Rumbo) as string[]).includes(rumbo)) throw new ErrorSms('rumbo inválido (N, S, E u O)');
    return {
      tipo: 'D',
      id: cortoAUuid(partes[2]),
      comunidadId: cortoAUuid(partes[3]),
      rumbo: rumbo as Rumbo,
      distanciaKm: leerNumero(partes[5], 'distancia'),
      fecha: leerHora(partes[6]),
    };
  }
  throw new ErrorSms('Formato de SMS no reconocido');
}

/**
 * Prepara un mensaje saliente para un solo segmento SMS: sin tildes ni símbolos fuera de ASCII (un solo
 * carácter no GSM-7 obliga a codificar en UCS-2 y el límite baja a 70) y recortado a 160 caracteres.
 */
export function smsPlano(texto: string): string {
  const ascii = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/Δ/g, 'dT')
    .replace(/[^\x20-\x7e]/g, '?');
  return ascii.length <= LARGO_MAXIMO_SMS ? ascii : `${ascii.slice(0, LARGO_MAXIMO_SMS - 3)}...`;
}
