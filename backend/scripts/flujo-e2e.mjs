#!/usr/bin/env node
/*
 * Recorre el flujo del Walking Skeleton (DoD del Bolt 0) hasta la bitácora y el cierre (Bolt 5) contra una API en
 * marcha con la semilla aplicada. Solo requiere Node 22 (sin bash ni curl): funciona igual en Windows, macOS y Linux.
 *
 *   node backend/scripts/flujo-e2e.mjs                         (API por defecto: http://localhost:3000/api)
 *   PowerShell: $env:API = "http://servidor/api"; node backend/scripts/flujo-e2e.mjs
 *
 * Tokens: por defecto los usuarios demo de la semilla (solo desarrollo); en otro entorno, definir
 * TOKEN_GUARDAPARQUE, TOKEN_COORDINADOR y TOKEN_JEFE con tokens reales.
 */
import { randomUUID } from 'node:crypto';

const API = process.env.API ?? 'http://localhost:3000/api';
const BRIGADA = '00000000-0000-4000-8000-000000000203'; // Brigada Departamental 3 (San Ignacio), de la semilla
const G = process.env.TOKEN_GUARDAPARQUE ?? 'demo-guardaparque';
const C = process.env.TOKEN_COORDINADOR ?? 'demo-coordinador';
const J = process.env.TOKEN_JEFE ?? 'demo-jefe-brigada';

async function pedir(metodo, token, ruta, cuerpo, tipo = 'application/json', cabeceras = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo !== undefined ? { 'Content-Type': tipo } : {}),
      ...cabeceras,
    },
    body: cuerpo === undefined ? undefined : tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo,
  });
  if (!res.ok) throw new Error(`${metodo} ${ruta} → HTTP ${res.status}: ${await res.text()}`);
  return res;
}
const post = async (token, ruta, cuerpo) => (await pedir('POST', token, ruta, cuerpo)).json();
const get = async (token, ruta) => (await pedir('GET', token, ruta)).json();

const ID = randomUUID();
const HACE_UNA_HORA = new Date(Date.now() - 3600e3).toISOString();

try {
  console.log(`API: ${API}`);
  console.log('1) Reporte GPS a ~2 km de Concepción');
  let r = await post(G, '/incidentes', {
    id: ID,
    latitud: -16.1153,
    longitud: -62.0258,
    precisionMetros: 8,
    fechaReporte: HACE_UNA_HORA,
  });
  console.log(`   ${r.estado} / riesgo ${r.nivelRiesgo}: ${r.justificacionRiesgo}`);

  console.log('2) Panel (columna Nuevo)');
  r = await get(C, '/panel');
  console.log(`   ${r.incidentes.Nuevo.length} foco(s) en Nuevo`);

  console.log('3) Brigada sugerida');
  r = await get(C, `/incidentes/${ID}/brigadas-sugeridas`);
  console.log(`   ${r[0].nombre} a ${r[0].distanciaKm} km`);

  console.log('4) Carta municipal (Ley 602)');
  const carta = Buffer.from(`%PDF-1.4\n% Carta municipal de ejemplo ${ID}\n%%EOF\n`, 'latin1');
  r = await (
    await pedir('POST', C, `/incidentes/${ID}/carta-municipal`, carta, 'application/pdf', {
      'x-fecha-emision': '2026-09-28',
    })
  ).json();
  console.log(`   ${r.estadoTramite} (${r.estado})`);

  console.log('5) Despacho confirmado por el coordinador');
  const asignacion = (await post(C, `/incidentes/${ID}/asignaciones`, { brigadaId: BRIGADA })).asignacion.id;
  console.log(`   asignación ${asignacion}`);

  console.log('6) Llegada confirmada');
  r = await post(J, `/asignaciones/${asignacion}/llegada`, { latitud: -16.115, longitud: -62.0255, precisionMetros: 10 });
  console.log(`   ΔT = ${r.deltaMinutos} min, ahorro ${r.ahorroPct} % vs. ${r.lineaBaseMinutos} min`);

  console.log('7) Historial inmutable');
  r = await get(C, `/incidentes/${ID}/historial`);
  console.log(`   ${r.map((h) => h.estadoNuevo).join(' → ')}`);

  console.log('8) Bitácora de turno (checklist, Bolt 5)');
  r = await post(J, `/incidentes/${ID}/bitacoras`, {
    id: randomUUID(),
    nivelAgua: 'Suficiente',
    nivelCombustible: 'Reserva',
    herramientasOperativas: true,
    kmFajaMitigados: 1.5,
    porcentajeControl: 60,
  });
  console.log(`   control ${r.porcentajeControl} %, combustible ${r.nivelCombustible}`);

  console.log('9) Cierre en 1 clic con informe PDF inmutable');
  r = await post(C, `/incidentes/${ID}/cierre`, { resultado: 'Controlado' });
  console.log(`   ${r.resultado} · ΔT ${r.tiempoTotalDespacho} min · SHA-256 ${r.sha256.slice(0, 16)}…`);
  const pdf = Buffer.from(await (await pedir('GET', C, `/incidentes/${ID}/informe/pdf`)).arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('el informe descargado no es un PDF');
  console.log(`   informe descargado: ${pdf.length} bytes, ${pdf.subarray(0, 8).toString('latin1')}`);

  console.log(`\nFlujo completo OK (incidente ${ID}).`);
} catch (error) {
  console.error(`\nEl flujo falló: ${error.message}`);
  if (error.cause) console.error(`  causa: ${error.cause.code ?? error.cause.message} (¿está la API en ${API}?)`);
  process.exitCode = 1;
}
