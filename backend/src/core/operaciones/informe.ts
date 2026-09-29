import { createHash } from 'node:crypto';
import { LineaPdf } from '../../common/pdf';
import { LINEA_BASE_MIN, META_AHORRO_PCT } from './operaciones.service';
import type { VistaBitacora } from './bitacora.service';
import type { EntradaHistorial } from './historial-estado.service';

/** Todo lo que compila el informe consolidado (HU-5.4, RF-13). Se arma dentro de la transacción del cierre. */
export interface DatosInforme {
  incidente: {
    id: string;
    tipoReporte: string;
    fechaReporte: Date;
    latitud: number;
    longitud: number;
    precisionMetros: number | null;
    rumbo: string | null;
    distanciaEstimadaKm: number | null;
    comunidad: string | null;
    nivelRiesgo: string | null;
    origenRiesgo: string;
    justificacionRiesgo: string | null;
    reactivaciones: number;
  };
  contacto: { nombre: string; telefono: string; cargo: string } | null;
  carta: { estado: string; fechaEmision: string; motivoRechazo: string | null } | null;
  asignaciones: Array<{ brigada: string; fechaAsignacion: Date; ruta: string | null; llegada: Date | null }>;
  notificaciones: Array<{ fecha: Date; brigada: string; canal: string; estado: string }>;
  tiempo: { deltaMinutos: number; ahorroPct: number; cumpleMeta: boolean } | null;
  bitacoras: VistaBitacora[];
  historial: EntradaHistorial[];
  cierre: { resultado: string; fecha: Date; coordinador: string; justificacion: string | null };
}

const ETIQUETA_RESULTADO: Record<string, string> = {
  Controlado: 'Controlado',
  Extendido: 'Extendido (supera la capacidad departamental)',
  Falso_Positivo: 'Falso positivo',
};
const ETIQUETA_ESTADO: Record<string, string> = {
  Nuevo: 'Nuevo',
  Asignado: 'Asignado',
  En_Atencion: 'En atención',
  En_Liquidacion: 'En liquidación',
  Cerrado: 'Cerrado',
};

const FORMATO = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Fecha y hora de Bolivia (UTC-4), "dd/mm/aaaa hh:mm". */
export function fechaBolivia(d: Date): string {
  return FORMATO.format(d).replace(',', '');
}

/** Huella SHA-256 de los datos compilados (el PDF no puede contener su propio hash; este sí) [inferencia]. */
export function huellaDatos(d: DatosInforme): string {
  return createHash('sha256').update(JSON.stringify(d)).digest('hex');
}

const col = (t: string, n: number) => (t.length > n ? t.slice(0, n) : t.padEnd(n));

/**
 * "Informe Técnico Consolidado de Incidente" (Acta ACTA-002, acuerdo 3; HU-5.4). Función pura: los mismos datos
 * producen siempre las mismas líneas.
 */
export function lineasInforme(d: DatosInforme): LineaPdf[] {
  const i = d.incidente;
  const l: LineaPdf[] = [];
  const t = (texto: string, estilo: LineaPdf['estilo'] = 'normal', sangria = 0) => l.push({ texto, estilo, sangria });

  t('Informe Técnico Consolidado de Incidente', 'titulo');
  t('Gobernación de Santa Cruz · COED · Chiquitanía — Sistema de apoyo a la decisión (MVP)', 'subtitulo');
  t(`FOCO-${i.id.slice(0, 8)} · Resultado: ${ETIQUETA_RESULTADO[d.cierre.resultado]} · Cerrado el ${fechaBolivia(d.cierre.fecha)}`, 'subtitulo');

  t('1. Foco de calor', 'seccion');
  t(`Identificador: ${i.id}`);
  t(`Reportado: ${fechaBolivia(i.fechaReporte)} · ${i.tipoReporte === 'Distancia' ? 'avistamiento a distancia' : 'GPS en el lugar'}`);
  t(
    `Coordenadas: ${i.latitud.toFixed(5)}, ${i.longitud.toFixed(5)}` +
      (i.precisionMetros !== null ? ` (±${Math.round(i.precisionMetros)} m)` : '') +
      (i.rumbo ? ` · humo al ${i.rumbo} a ${i.distanciaEstimadaKm} km de la comunidad` : ''),
  );
  t(`Comunidad más cercana: ${i.comunidad ?? 'sin comunidad en el catálogo'}`);
  t(
    d.contacto
      ? `Referente comunal: ${d.contacto.nombre} · ${d.contacto.telefono} (${d.contacto.cargo})`
      : 'Referente comunal: no registrado',
  );

  t('2. Riesgo (motor explicable y decisiones humanas)', 'seccion');
  t(`Nivel final: ${i.nivelRiesgo ?? 'sin calcular'} (${i.origenRiesgo === 'Manual' ? 'fijado por el coordinador' : 'calculado por el motor'})`);
  t(`Justificación del algoritmo: ${i.justificacionRiesgo ?? '—'}`);
  const decisiones = d.historial.filter((h) => h.tipoEvento !== 'CambioEstado');
  if (!decisiones.length) t('Sin reclasificaciones ni reactivaciones.', 'nota');
  for (const h of decisiones) {
    const tipo = h.tipoEvento === 'Reactivacion' ? 'Reactivación' : 'Reclasificación';
    t(
      `${fechaBolivia(h.creadoEn)} · ${tipo} ${h.nivelAnterior ?? '—'} -> ${h.nivelNuevo ?? '—'} por ${h.usuario?.nombre ?? 'sistema'}: ${h.justificacion}`,
      'normal',
      12,
    );
  }

  t('3. Trámite municipal (Ley N.º 602)', 'seccion');
  t(
    d.carta
      ? `Carta municipal: ${d.carta.estado} · emitida el ${d.carta.fechaEmision}` +
          (d.carta.motivoRechazo ? ` · motivo del rechazo: ${d.carta.motivoRechazo}` : '')
      : 'Sin carta municipal (no hubo despacho departamental).',
  );

  t('4. Despacho, llegada y avisos', 'seccion');
  if (!d.asignaciones.length) t('No se despachó ninguna brigada.', 'nota');
  for (const a of d.asignaciones) {
    t(
      `${a.brigada}: asignada ${fechaBolivia(a.fechaAsignacion)}` +
        (a.ruta ? ` · ruta ${a.ruta}` : '') +
        ` · ${a.llegada ? `llegada ${fechaBolivia(a.llegada)}` : 'sin llegada confirmada'}`,
      'normal',
      12,
    );
  }
  for (const n of d.notificaciones) {
    t(`Aviso ${n.canal} a ${n.brigada}: ${n.estado} (${fechaBolivia(n.fecha)})`, 'nota', 12);
  }

  t('5. Tiempo de despacho (KPI, HU-5.3)', 'seccion');
  if (d.tiempo) {
    t(
      `ΔT (reporte -> llegada) = ${d.tiempo.deltaMinutos} min · línea base ${LINEA_BASE_MIN} min · ahorro ${d.tiempo.ahorroPct} % · ` +
        (d.tiempo.cumpleMeta ? `cumple la meta del ${META_AHORRO_PCT} %` : `no alcanza la meta del ${META_AHORRO_PCT} %`),
    );
  } else {
    t('Sin llegada confirmada: el ΔT no aplica a este incidente.', 'nota');
  }

  t('6. Bitácoras de turno (RF-12)', 'seccion');
  if (!d.bitacoras.length) {
    t('Sin bitácoras registradas.', 'nota');
  } else {
    t(`${col('Fecha', 17)}${col('Agua', 11)}${col('Combust.', 9)}${col('Herram.', 9)}${col('Faja km', 9)}${col('Control', 9)}Canal`, 'tabla');
    for (const b of d.bitacoras) {
      t(
        col(fechaBolivia(b.fecha), 17) +
          col(b.nivelAgua === 'Critica' ? 'Crítica' : b.nivelAgua, 11) +
          col(b.nivelCombustible, 9) +
          col(b.herramientasOperativas ? 'Operat.' : 'Fallas', 9) +
          col(String(b.kmFajaMitigados), 9) +
          col(`${b.porcentajeControl} %${b.controlRetrocede ? '!' : ''}`, 9) +
          b.canal,
        'tabla',
      );
    }
    const ultima = d.bitacoras[d.bitacoras.length - 1];
    t(
      `Última bitácora: ${ultima.porcentajeControl} % de control y ${ultima.kmFajaMitigados} km de faja.` +
        (d.bitacoras.some((b) => b.controlRetrocede) ? ' "!" = el control bajó respecto de la bitácora anterior (rebrote).' : ''),
      'nota',
    );
  }

  t('7. Cierre', 'seccion');
  t(`Resultado: ${ETIQUETA_RESULTADO[d.cierre.resultado]} · ${fechaBolivia(d.cierre.fecha)} · por ${d.cierre.coordinador}`);
  if (d.cierre.justificacion) {
    t(`${d.cierre.resultado === 'Falso_Positivo' ? 'Justificación del falso positivo' : 'Observación'}: ${d.cierre.justificacion}`);
  }

  t('8. Historial del ciclo de vida (append-only, RNF-07)', 'seccion');
  for (const h of d.historial) {
    const estados =
      h.estadoAnterior && h.estadoAnterior !== h.estadoNuevo
        ? `${ETIQUETA_ESTADO[h.estadoAnterior]} -> ${ETIQUETA_ESTADO[h.estadoNuevo]}`
        : ETIQUETA_ESTADO[h.estadoNuevo];
    t(`${fechaBolivia(h.creadoEn)} · ${estados} · ${h.usuario?.nombre ?? 'sistema'}: ${h.justificacion}`, 'nota', 12);
  }

  t('', 'normal');
  t(`Huella de los datos compilados (SHA-256): ${huellaDatos(d)}`, 'nota');
  t('Documento inmutable: generado una sola vez al cerrar el incidente; la base de datos rechaza su modificación.', 'nota');
  return l;
}
