import { textoGsm } from '../sync/sms/codec-sms';

export interface DatosOrden {
  incidenteId: string;
  nivelRiesgo: string | null;
  latitud: number;
  longitud: number;
  /** "165 km al NE (…)" o null. */
  ruta: string | null;
  contacto: { nombre: string; telefono: string; cargo: string } | null;
}

const MAXIMO_SMS = 160;

/** Distancia y rumbo de la ruta ("165 km al NE"), sin las coordenadas que el SMS ya lleva. */
function tramo(ruta: string | null): string {
  const m = ruta ? /^([\d.]+ km al [A-Z]+)/.exec(ruta) : null;
  return m ? m[1].replace(' km al ', 'km ') : '';
}

/**
 * SMS de despacho (HU-4.2, RF-11, RNF-02): ≤160 caracteres GSM-7 con el foco, el riesgo, las coordenadas, la ruta
 * en línea recta y el referente comunal. Si no entra, se acorta el nombre del referente (nunca el teléfono).
 * Ej.: `DESPACHO F-ab12cd34 Alto -16.11530,-62.02580 165km NE. Ref: Juan Perez 70012345 Corregidor. Abra la app`
 */
export function mensajeDespachoSms(o: DatosOrden): string {
  const base = `DESPACHO F-${o.incidenteId.slice(0, 8)} ${o.nivelRiesgo ?? ''} ${o.latitud.toFixed(5)},${o.longitud.toFixed(5)} ${tramo(o.ruta)}`
    .replace(/\s+/g, ' ')
    .trim();
  if (!o.contacto) return textoGsm(`${base}. Sin referente comunal. Abra la app`).slice(0, MAXIMO_SMS);
  const armar = (nombre: string, cola: string) => textoGsm(`${base}. Ref: ${nombre} ${o.contacto!.telefono}${cola}`);
  for (const cola of [` ${o.contacto.cargo}. Abra la app`, '. Abra la app', '']) {
    const texto = armar(o.contacto.nombre, cola);
    if (texto.length <= MAXIMO_SMS) return texto;
  }
  const sinNombre = armar('', '').length;
  const nombre = textoGsm(o.contacto.nombre).slice(0, Math.max(3, MAXIMO_SMS - sinNombre));
  return armar(nombre, '').slice(0, MAXIMO_SMS);
}
