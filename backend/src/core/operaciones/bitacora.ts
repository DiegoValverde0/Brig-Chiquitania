import { BadRequestException } from '@nestjs/common';
import { exigirEnum, exigirNumero, exigirObjeto, exigirUuid, fechaDelCliente } from '../../common/validacion';
import { NivelAgua, NivelCombustible } from './enums/nivel-bitacora.enum';

/** RS-02: la bitácora se sincroniza en menos de 1 KB (texto plano JSON). */
export const PESO_MAXIMO_BITACORA = 1024;
export const KM_FAJA_MAXIMO = 500;

export interface DatosBitacora {
  id: string;
  fecha: Date;
  nivelAgua: NivelAgua;
  nivelCombustible: NivelCombustible;
  herramientasOperativas: boolean;
  kmFajaMitigados: number;
  porcentajeControl: number;
}

const CAMPOS = ['id', 'fecha', 'nivelAgua', 'nivelCombustible', 'herramientasOperativas', 'kmFajaMitigados', 'porcentajeControl'];

/**
 * HU-5.2 / RF-12: valida el checklist (función pura). Solo los campos del UML: la bitácora es un checklist, nunca
 * texto libre (AGENTS.md §5), así que cualquier otro campo se rechaza.
 */
export function leerBitacora(body: unknown, ahora = new Date()): DatosBitacora {
  const datos = exigirObjeto(body);
  const extra = Object.keys(datos).filter((k) => !CAMPOS.includes(k));
  if (extra.length) {
    throw new BadRequestException(`La bitácora es un checklist: campo no permitido (${extra.join(', ')})`);
  }
  if (typeof datos.herramientasOperativas !== 'boolean') {
    throw new BadRequestException('herramientasOperativas debe ser true o false');
  }
  const porcentaje = exigirNumero(datos.porcentajeControl, 'porcentajeControl', 0, 100);
  if (!Number.isInteger(porcentaje)) throw new BadRequestException('porcentajeControl debe ser un entero de 0 a 100');
  const km = exigirNumero(datos.kmFajaMitigados, 'kmFajaMitigados', 0, KM_FAJA_MAXIMO);
  return {
    id: exigirUuid(datos.id, 'id'),
    fecha: fechaDelCliente(datos.fecha, 'fecha', ahora),
    nivelAgua: exigirEnum(datos.nivelAgua, 'nivelAgua', Object.values(NivelAgua)),
    nivelCombustible: exigirEnum(datos.nivelCombustible, 'nivelCombustible', Object.values(NivelCombustible)),
    herramientasOperativas: datos.herramientasOperativas,
    kmFajaMitigados: Math.round(km * 10) / 10,
    porcentajeControl: porcentaje,
  };
}
