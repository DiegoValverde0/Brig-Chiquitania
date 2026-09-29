/*
 * Prueba de la app web (CU-01) en Chromium real, contra una API en marcha con la semilla aplicada y
 * FRONTEND_DIR apuntando a frontend/app (o detrás de nginx).
 *
 *   APP=http://localhost:3000 node app.prueba.mjs
 *
 * Cubre la DoD del Bolt 1 desde el teléfono: reporte GPS con foto comprimida ≤100 KB, contacto comunal
 * autocompletado offline, reporte sin datos (cola en IndexedDB + SMS ≤160) que sobrevive a recargar la app sin
 * red y se sincroniza solo al volver la señal, envío por la pasarela SMS simulada y consumo de memoria (RS-01).
 * Bolt 2: evaluación y reclasificación del riesgo. Bolt 3: panel COED con 60 focos simulados (filtros de carta,
 * contadores, 4 estados de brigada, mapa esquemático), carta de la UGR → validación/rechazo del coordinador y
 * reporte "En Liquidación" del jefe de brigada; capturas a 1366 px y 360 px.
 * Bolt 4: despacho en 1 clic desde el panel (doble clic → una sola asignación), aviso al jefe (SMS simulado),
 * orden de salida en "Mi brigada" (leída) con llegada por GPS, y reactivación → reasignación táctica en 1 clic.
 * Bolt 5: bitácora de turno sin conexión (cola, sobrevive a recargar, se sincroniza sola) y cierre en 1 clic con
 * descarga del informe consolidado en PDF; lista de informes con el KPI.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM ?? buscarChrome();
const CERCA_DE_CONCEPCION = { latitude: -16.1153, longitude: -62.0258, accuracy: 8 };
// fileURLToPath y no `.pathname`: en Windows `.pathname` da "/C:/..." y termina en "C:\\C:\\...".
const CAPTURAS = fileURLToPath(new URL('./capturas/', import.meta.url));

/** Sin la variable CHROMIUM, usa el Chrome/Chromium instalado en su ruta habitual (Windows, macOS o Linux). */
function buscarChrome() {
  const windows = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean)
    .map((base) => `${base}\\Google\\Chrome\\Application\\chrome.exe`);
  const candidatos = [
    '/opt/pw-browsers/chromium',
    ...windows,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const encontrado = candidatos.find((ruta) => existsSync(ruta));
  if (!encontrado) {
    console.error('No se encontró Chrome/Chromium. Indique su ruta en la variable CHROMIUM (ver GUIA_DESARROLLO.md §4).');
    process.exit(1);
  }
  return encontrado;
}

const resultados = [];
async function paso(nombre, fn) {
  const inicio = Date.now();
  try {
    await fn();
    resultados.push({ nombre, ok: true, ms: Date.now() - inicio });
    console.log(`  ✓ ${nombre}`);
  } catch (error) {
    resultados.push({ nombre, ok: false });
    console.log(`  ✗ ${nombre}\n    ${error.stack ?? error}`);
    throw error;
  }
}

/** PNG de ruido de ancho×alto (varios MB): obliga a la app a comprimir de verdad. */
function pngRuido(ancho, alto) {
  const fila = 1 + ancho * 3;
  const crudo = randomBytes(fila * alto);
  for (let y = 0; y < alto; y++) crudo[y * fila] = 0; // filtro "None" por fila
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([largo, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('IDAT', deflateSync(crudo)),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}

async function api(ruta, token = 'demo-coordinador') {
  const res = await fetch(`${APP}/api${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
  return { estado: res.status, datos: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.arrayBuffer() };
}

/** Llamada a la API con cuerpo JSON o binario (preparación de datos de las pruebas). */
async function llamar(metodo, ruta, token, cuerpo, cabeceras = {}) {
  const binario = Buffer.isBuffer(cuerpo);
  const res = await fetch(`${APP}/api${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(cuerpo === undefined ? {} : { 'Content-Type': binario ? 'application/pdf' : 'application/json' }),
      ...cabeceras,
    },
    body: cuerpo === undefined ? undefined : binario ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await res.text();
  return { estado: res.status, datos: texto ? JSON.parse(texto) : null };
}

const COMUNIDADES = [
  { nombre: 'Concepción', latitud: -16.1333, longitud: -62.0258 },
  { nombre: 'San Javier', latitud: -16.2747, longitud: -62.5064 },
  { nombre: 'San Ignacio de Velasco', latitud: -16.3667, longitud: -60.95 },
  { nombre: 'San Rafael de Velasco', latitud: -16.7869, longitud: -60.6747 },
  { nombre: 'Santa Ana de Velasco', latitud: -16.585, longitud: -60.6883 },
  { nombre: 'San José de Chiquitos', latitud: -17.8456, longitud: -60.7394 },
  { nombre: 'Roboré', latitud: -18.3308, longitud: -59.7594 },
];
const BRIGADA = (n) => `00000000-0000-4000-8000-00000000020${n}`;
/** Jefe demo de cada brigada (semilla del Bolt 4). */
const JEFE_DE = {
  [BRIGADA(1)]: 'demo-jefe-1',
  [BRIGADA(2)]: 'demo-jefe-2',
  [BRIGADA(3)]: 'demo-jefe-brigada',
  [BRIGADA(4)]: 'demo-jefe-4',
};
const pdf = (etiqueta) => Buffer.from(`%PDF-1.4\n% Carta municipal de prueba ${etiqueta}\n%%EOF\n`);

/** Crea un foco a `km` al norte de la comunidad y, si se pide, le adjunta una carta (UGR). */
async function focoSimulado(i, km, conCarta) {
  const c = COMUNIDADES[i % COMUNIDADES.length];
  const id = crypto.randomUUID();
  const alta = await llamar('POST', '/incidentes', 'demo-guardaparque', {
    id,
    latitud: c.latitud + km / 111.195,
    longitud: c.longitud,
    precisionMetros: 8,
  });
  assert.equal(alta.estado, 201);
  if (conCarta) {
    const carta = await llamar('POST', `/incidentes/${id}/carta-municipal`, 'demo-ugr', pdf(id), { 'x-fecha-emision': '2026-09-28' });
    assert.equal(carta.estado, 201);
  }
  return { id, comunidad: c };
}

/** Despacha la brigada al foco y, si se pide, confirma la llegada (→ En Combate Activo). */
async function despachar(foco, brigada, llegar) {
  const d = await llamar('POST', `/incidentes/${foco.id}/asignaciones`, 'demo-coordinador', { brigadaId: brigada });
  assert.equal(d.estado, 201, JSON.stringify(d.datos));
  if (llegar) {
    const l = await llamar('POST', `/asignaciones/${d.datos.asignacion.id}/llegada`, 'demo-jefe-brigada', {
      latitud: foco.comunidad.latitud,
      longitud: foco.comunidad.longitud,
      precisionMetros: 10,
    });
    assert.equal(l.estado, 201);
  }
}

async function entrarComo(navegador, token, viewport, extra = {}) {
  // Movimiento reducido: sin transiciones, las capturas no quedan a mitad de una animación.
  const ctx = await navegador.newContext({ viewport, deviceScaleFactor: 1, locale: 'es-BO', reducedMotion: 'reduce', ...extra });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(`    [error de la página] ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(APP);
  await p.fill('#token', token);
  await p.click('#form-login button');
  await p.locator('#vista-principal').waitFor();
  return { ctx, p };
}

const pestanasVisibles = (p) =>
  p.$$eval('#pestanas button', (bs) => bs.filter((b) => !b.hidden).map((b) => b.querySelector('.texto').textContent.trim()));
const sinDesbordeHorizontal = (p) =>
  p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Abre "ver más" en la columna hasta que la tarjeta del foco quede visible y la devuelve. */
async function tarjetaDelPanel(p, id) {
  const t = p.locator(`#kanban .tarjeta-foco[data-id="${id}"]`);
  await p.locator('#kanban .columna').first().waitFor();
  for (let i = 0; i < 10 && (await t.count()) === 0; i++) {
    const mas = p.locator('#kanban .ver-mas').first();
    if ((await mas.count()) === 0) break;
    await mas.click();
  }
  return t;
}

const tarjeta = (pagina, texto) => pagina.locator('#lista-reportes li.reporte', { hasText: texto }).first();

async function main() {
  mkdirSync(CAPTURAS, { recursive: true });
  // VER=1: ventana visible y pausa entre acciones (VER_MS, 400 ms por defecto) para seguir la prueba en vivo.
  const ver = process.env.VER === '1';
  const navegador = await chromium.launch({
    executablePath: CHROMIUM,
    headless: !ver,
    slowMo: ver ? Number(process.env.VER_MS ?? 400) : 0,
  });
  // VIDEO=1: un .webm por contexto en capturas/videos/ (salvo en la medición de memoria, que se falsearía).
  const videos = [];
  if (process.env.VIDEO === '1') {
    const crear = navegador.newContext.bind(navegador);
    navegador.newContext = async ({ sinVideo, ...opciones } = {}) => {
      if (sinVideo) return crear(opciones);
      const ctx = await crear({ ...opciones, recordVideo: { dir: `${CAPTURAS}videos`, size: opciones.viewport } });
      ctx.on('page', (p) => videos.push(p.video()));
      return ctx;
    };
  }
  const contexto = await navegador.newContext({
    viewport: { width: 360, height: 740 }, // teléfono de gama baja
    deviceScaleFactor: 1,
    permissions: ['geolocation'],
    geolocation: CERCA_DE_CONCEPCION,
    locale: 'es-BO',
  });
  const pagina = await contexto.newPage();
  const cdp = await contexto.newCDPSession(pagina);
  await cdp.send('Performance.enable');
  pagina.on('pageerror', (e) => console.log(`    [error de la página] ${e.message}`));

  console.log(`App: ${APP}`);
  try {
    await paso('inicio de sesión con código de acceso y descarga del catálogo comunal', async () => {
      await pagina.goto(APP);
      await pagina.fill('#token', 'código-incorrecto');
      await pagina.click('#form-login button');
      await pagina.locator('#error-login', { hasText: 'inválido' }).waitFor();
      await pagina.fill('#token', 'demo-guardaparque');
      await pagina.click('#form-login button');
      await pagina.locator('#vista-principal').waitFor();
      await pagina.waitForFunction(() => document.getElementById('version-catalogo').textContent === '7 comunidades');
      assert.equal(await pagina.textContent('#estado-red'), 'Con datos');
      assert.ok(await pagina.locator('#pestanas').isHidden(), 'el guardaparque no ve la pestaña de evaluación');
      // El service worker queda instalado y controlando la página (necesario para abrir sin red).
      await pagina.evaluate(() => navigator.serviceWorker.ready);
      await pagina.reload();
      await pagina.waitForFunction(() => !!navigator.serviceWorker.controller);
    });

    let idGps;
    await paso('HU-1.1: GPS ≤15 m + foto comprimida a ≤100 KB + contacto autocompletado; llega a la central', async () => {
      await pagina.click('#capturar-gps');
      await pagina.locator('#lectura-gps', { hasText: '✔' }).waitFor();
      await pagina.locator('#contacto', { hasText: 'Referente de ejemplo Concepción' }).waitFor();
      const png = pngRuido(1600, 1200);
      assert.ok(png.length > 1024 * 1024, 'la foto de prueba debe pesar más de 1 MB');
      await pagina.setInputFiles('#archivo-foto', { name: 'foco.png', mimeType: 'image/png', buffer: png });
      await pagina.locator('#peso-foto', { hasText: 'KB' }).waitFor();
      const kb = parseInt(await pagina.textContent('#peso-foto'), 10);
      assert.ok(kb <= 100, `foto comprimida a ${kb} KB`);
      await pagina.screenshot({ path: `${CAPTURAS}01-reporte-gps.png`, fullPage: true });
      await pagina.click('#enviar');
      const item = tarjeta(pagina, 'Foco GPS');
      await item.locator('.estado', { hasText: 'Recibido' }).waitFor();
      await item.locator('.detalle', { hasText: 'Foto enviada' }).waitFor();
      assert.match(await item.textContent(), /Riesgo Alto/);
      idGps = await item.getAttribute('data-id');
      const foto = await api(`/incidentes/${idGps}/evidencia`);
      assert.equal(foto.estado, 200);
      assert.ok(foto.datos.byteLength <= 100 * 1024, `foto en el servidor: ${foto.datos.byteLength} bytes`);
    });

    let idOffline;
    await paso('sin datos: el reporte a distancia queda en cola y muestra el SMS de ≤160 caracteres', async () => {
      await contexto.setOffline(true);
      await pagina.locator('#estado-red', { hasText: 'Sin datos' }).waitFor();
      await pagina.click('label:has(> input[name="modo"][value="Distancia"])');
      await pagina.selectOption('#comunidad', { label: 'Concepción' });
      await pagina.check('input[name="rumbo"][value="E"]');
      await pagina.fill('#distancia', '4');
      await pagina.locator('#contacto', { hasText: 'Contacto comunal:' }).waitFor();
      await pagina.click('#enviar');
      await pagina.locator('#aviso-envio', { hasText: 'Sin señal' }).waitFor();
      const item = tarjeta(pagina, 'Humo a 4 km al E de Concepción');
      await item.locator('.estado', { hasText: 'En cola' }).waitFor();
      const sms = (await item.locator('.texto-sms').textContent()).split('  (')[0];
      assert.match(sms, /^BRC1 D [A-Za-z0-9_-]{22} [A-Za-z0-9_-]{22} E 4 [0-9a-z]+$/);
      assert.ok(sms.length <= 160);
      assert.match(await item.locator('.abrir-sms').getAttribute('href'), /^sms:\+?\d+\?body=BRC1%20D/);
      idOffline = await item.getAttribute('data-id');
      await pagina.screenshot({ path: `${CAPTURAS}02-sin-datos-sms.png`, fullPage: true });
    });

    await paso('RNF-01: la app abre sin red y el reporte sigue guardado en el teléfono', async () => {
      await pagina.reload();
      await pagina.locator('#vista-principal').waitFor();
      await tarjeta(pagina, 'Humo a 4 km').locator('.estado', { hasText: 'En cola' }).waitFor();
      assert.equal((await api(`/incidentes/${idOffline}`)).estado, 404, 'todavía no llegó al servidor');
    });

    await paso('al volver la señal se sincroniza solo, sin duplicar', async () => {
      await contexto.setOffline(false);
      const item = tarjeta(pagina, 'Humo a 4 km');
      await item.locator('.estado', { hasText: 'Recibido' }).waitFor({ timeout: 15000 });
      const remoto = await api(`/incidentes/${idOffline}`);
      assert.equal(remoto.estado, 200);
      assert.equal(remoto.datos.tipoReporte, 'Distancia');
      assert.equal(remoto.datos.rumbo, 'E');
      assert.equal(remoto.datos.nivelRiesgo, 'Alto');
    });

    await paso('HU-1.3: con "simular falta de datos" el reporte viaja por la pasarela SMS simulada', async () => {
      await pagina.click('.ajustes summary'); // "Ajustes" viene plegado
      await pagina.check('#simular-sin-datos');
      await pagina.locator('#estado-red', { hasText: 'Sin datos' }).waitFor();
      await pagina.click('label:has(> input[name="modo"][value="GPS"])');
      await pagina.click('#capturar-gps');
      await pagina.locator('#lectura-gps', { hasText: '✔' }).waitFor();
      await pagina.click('#enviar');
      const item = tarjeta(pagina, 'Foco GPS');
      await item.locator('.estado', { hasText: 'En cola' }).waitFor();
      const id = await item.getAttribute('data-id');
      await item.locator('.simular-sms').click();
      await item.locator('.estado', { hasText: 'Recibido por SMS' }).waitFor();
      const bandeja = await api('/sms/mensajes');
      const mensajes = bandeja.datos.filter((m) => m.incidenteId === id);
      assert.deepEqual(mensajes.map((m) => m.direccion).sort(), ['Entrante', 'Saliente']);
      await pagina.screenshot({ path: `${CAPTURAS}03-recibido-por-sms.png`, fullPage: true });
      await pagina.uncheck('#simular-sin-datos');
    });

    await paso('HU-2.1 / HU-2.2: el coordinador ve la explicación del motor y reclasifica con ≥15 caracteres', async () => {
      // Foco a ~10 km al norte de Concepción ⇒ Medio, creado por el guardaparque.
      const id = crypto.randomUUID();
      const alta = await fetch(`${APP}/api/incidentes`, {
        method: 'POST',
        headers: { Authorization: 'Bearer demo-guardaparque', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, latitud: -16.1333 + 10 / 111.195, longitud: -62.0258, precisionMetros: 8 }),
      });
      assert.equal(alta.status, 201);

      const ctx = await navegador.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 });
      const p = await ctx.newPage();
      await p.goto(APP);
      await p.fill('#token', 'demo-coordinador');
      await p.click('#form-login button');
      await p.locator('#pestanas').waitFor();
      await p.click('#tab-evaluacion');
      assert.equal(await p.textContent('#titulo'), 'Evaluación de riesgo');
      const item = p.locator(`#lista-focos li[data-id="${id}"]`);
      await item.waitFor();
      assert.match(await item.textContent(), /Medio/);
      await item.locator('.foco-boton').click();
      await p.locator('#detalle-foco').waitFor();
      assert.match(await p.textContent('#detalle-justificacion'), /Comunidad habitada en el área de influencia: Concepción/);
      assert.match(await p.textContent('#detalle-distancia'), /Distancia a comunidad: 10 km \(Concepción\)/);
      assert.ok(await p.locator('input[name="nivel"][value="Medio"]').isDisabled(), 'no se puede elegir el nivel vigente');

      await p.click('label:has(> input[name="nivel"][value="Alto"])');
      await p.fill('#justificacion', 'Humo muy denso');
      assert.equal(await p.textContent('#contador'), '14/15 car.');
      assert.ok(await p.locator('#guardar-reclasificacion').isDisabled(), 'DoD 3: bloqueado con 14 caracteres');
      await p.fill('#justificacion', 'Humo muy denso hacia la comunidad');
      assert.ok(await p.locator('#guardar-reclasificacion').isEnabled());
      await p.screenshot({ path: `${CAPTURAS}04-evaluacion-riesgo.png`, fullPage: true });
      await p.click('#guardar-reclasificacion');
      await p.locator('#mensaje-reclasificacion', { hasText: '✔' }).waitFor();
      assert.equal(await p.textContent('#detalle-nivel'), 'Alto');
      assert.match(await p.textContent('#detalle-historial'), /Medio → Alto[\s\S]*Coordinador COED \(demo\)[\s\S]*Humo muy denso hacia la comunidad/);
      await p.screenshot({ path: `${CAPTURAS}05-reclasificado.png`, fullPage: true });

      const evaluacion = await api(`/incidentes/${id}/evaluacion`);
      assert.equal(evaluacion.datos.nivelRiesgo, 'Alto');
      assert.equal(evaluacion.datos.origenRiesgo, 'Manual');
      await ctx.close();
    });

    // ---------------- Bolt 3: panel COED, cartas municipales y estados tácticos ----------------
    const focos = [];
    await paso('Bolt 3 · preparación: 60 focos simulados (1 de cada 3 con carta) y brigadas en 4 estados', async () => {
      for (let i = 0; i < 60; i++) focos.push(await focoSimulado(i, 1 + (i % 14), i % 3 === 0));
      // B1 en desplazamiento, B4 en combate, B3 (del jefe demo) en combate; B2 sigue disponible.
      const conCarta = focos.filter((_, i) => i % 3 === 0);
      await despachar(conCarta[0], BRIGADA(1), false);
      await despachar(conCarta[1], BRIGADA(4), true);
      await despachar(conCarta[2], BRIGADA(3), true);
    });

    await paso('RF-08: el jefe de brigada reporta "En Liquidación / Por finalizar" desde su teléfono', async () => {
      const { ctx, p } = await entrarComo(navegador, 'demo-jefe-brigada', { width: 360, height: 740 });
      assert.deepEqual(await pestanasVisibles(p), ['Reportar', 'Brigada']);
      assert.equal(await p.getAttribute('#tab-brigada', 'aria-selected'), 'true', 'el jefe entra directo a su brigada');
      await p.click('#tab-brigada');
      await p.locator('#estado-mi-brigada', { hasText: 'En combate activo' }).waitFor();
      assert.match(await p.textContent('#mi-brigada'), /Brigada Departamental 3[\s\S]*Foco asignado: FOCO-/);
      await p.click('#reportar-liquidacion');
      await p.locator('#estado-mi-brigada', { hasText: 'En liquidación' }).waitFor();
      assert.ok(await p.locator('#reportar-liquidacion').isHidden(), 'el botón solo aparece En Combate Activo');
      assert.match(await p.textContent('#mi-brigada'), /En liquidación/);
      await p.screenshot({ path: `${CAPTURAS}06-mi-brigada-liquidacion.png`, fullPage: true });
      await ctx.close();
    });

    let focoUgr;
    await paso('CU-08: la UGR adjunta la foto de la carta (comprimida a ≤1 MB) y queda "por validar"', async () => {
      focoUgr = await focoSimulado(0, 3, false);
      const { ctx, p } = await entrarComo(navegador, 'demo-ugr', { width: 360, height: 740 });
      assert.deepEqual(await pestanasVisibles(p), ['Reportar', 'Cartas', 'Informes']);
      assert.equal(await p.getAttribute('#tab-cartas', 'aria-selected'), 'true', 'la UGR entra directo a las cartas');
      await p.click('#tab-cartas');
      const item = p.locator(`#lista-cartas li[data-id="${focoUgr.id}"]`);
      await item.waitFor();
      const foto = pngRuido(1600, 1200);
      assert.ok(foto.length > 1024 * 1024, 'la foto de la carta debe superar 1 MB');
      await item.locator('input[type="file"]').setInputFiles({ name: 'carta.png', mimeType: 'image/png', buffer: foto });
      await item.locator('.peso-carta', { hasText: 'comprimida' }).waitFor();
      const kb = parseInt((await item.locator('.peso-carta').textContent()).split('· ')[1], 10);
      assert.ok(kb <= 1024, `carta comprimida a ${kb} KB`);
      await item.locator('button[type="submit"]').click();
      await item.locator('.destacado', { hasText: 'Carta adjunta' }).waitFor();
      await p.screenshot({ path: `${CAPTURAS}07-carta-ugr.png`, fullPage: true });
      const carta = await api(`/incidentes/${focoUgr.id}/carta-municipal`);
      assert.equal(carta.datos.estado, 'por_validar');
      assert.equal(carta.datos.tipoMime, 'image/jpeg');
      await ctx.close();
    });

    await paso('HU-3.1 / RNF-05: panel COED a 1366 px con 60+ focos, 4 columnas, contadores y 4 estados de brigada', async () => {
      const { ctx, p } = await entrarComo(navegador, 'demo-coordinador', { width: 1366, height: 900 });
      assert.deepEqual(await pestanasVisibles(p), ['Reportar', 'Panel', 'Riesgo', 'Cartas', 'Informes']);
      assert.equal(await p.getAttribute('#tab-panel', 'aria-selected'), 'true', 'el coordinador entra directo al panel');
      await p.click('#tab-panel');
      await p.locator('#kanban .tarjeta-foco').first().waitFor();
      const panel = (await api('/panel')).datos;
      assert.ok(panel.resumen.total >= 60, `focos activos: ${panel.resumen.total}`);
      assert.equal(await p.locator('#kanban .columna').count(), 4);
      // Contadores de columna = API; "ver más" limita a 15 tarjetas visibles por columna.
      for (const c of ['Nuevo', 'Asignado', 'En_Atencion', 'En_Liquidacion']) {
        const col = p.locator(`#kanban .columna[data-columna="${c}"]`);
        const { total, conCarta } = panel.resumen.columnas[c];
        assert.equal(await col.locator('.contador-columna').textContent(), `${total} · ${conCarta} con carta`);
        assert.equal(await col.locator('.tarjeta-foco').count(), Math.min(15, total));
      }
      const nuevo = p.locator('#kanban .columna[data-columna="Nuevo"]');
      await nuevo.locator('.ver-mas').click();
      assert.equal(await nuevo.locator('.tarjeta-foco').count(), Math.min(30, panel.resumen.columnas.Nuevo.total));
      assert.ok(await sinDesbordeHorizontal(p), 'el panel no desborda la página a lo ancho');
      // 4 estados de brigada: conteo, lista y símbolos del mapa.
      for (const e of ['Disponible', 'En_Desplazamiento', 'En_Combate_Activo', 'En_Liquidacion']) {
        assert.match(await p.textContent(`#conteo-brigadas li[data-estado="${e}"]`), /1 /, e);
        assert.equal(await p.locator(`#lista-brigadas li[data-estado="${e}"]`).count(), 1, e);
      }
      const simbolos = await p.$$eval('#mapa-panel .mapa-brigada', (ts) => ts.map((t) => t.textContent.slice(0, 1)).sort());
      assert.deepEqual(simbolos, ['#', '*', '^', '~']); // En combate, Disponible, En desplazamiento, En liquidación
      const grupos = await p.locator('#mapa-panel .mapa-foco').count();
      assert.ok(grupos > 0 && grupos < panel.resumen.total, `focos agrupados en ${grupos} marcas`);
      await p.screenshot({ path: `${CAPTURAS}08-panel-coed-1366.png`, fullPage: true });

      // RF-07: filtros de trámite municipal; las tarjetas y contadores cambian.
      const cartasVisibles = () => p.$$eval('#kanban .tarjeta-foco', (ts) => ts.map((t) => t.dataset.carta));
      const esperarResumen = (visibles) => p.locator('#resumen-panel', { hasText: `Mostrando ${visibles} de` }).waitFor();
      await p.click('label:has(> input[name="carta"][value="por_validar"])');
      await esperarResumen((await api('/panel?carta=por_validar')).datos.resumen.visibles);
      assert.ok((await cartasVisibles()).every((c) => c === 'por_validar'));
      assert.equal(await (await tarjetaDelPanel(p, focoUgr.id)).count(), 1);
      await p.click('label:has(> input[name="carta"][value="sin"])');
      const sin = (await api('/panel?carta=sin')).datos;
      await esperarResumen(sin.resumen.visibles);
      assert.ok((await cartasVisibles()).every((c) => c === 'sin_carta' || c === 'rechazada'));
      assert.equal(await p.locator(`#kanban .tarjeta-foco[data-id="${focoUgr.id}"]`).count(), 0);
      assert.equal(
        await p.locator('#kanban .columna[data-columna="Nuevo"] .contador-columna').textContent(),
        `${sin.resumen.columnas.Nuevo.total} · 0 con carta`,
      );
      await p.screenshot({ path: `${CAPTURAS}09-panel-filtro-sin-carta.png`, fullPage: true });
      await p.click('label:has(> input[name="carta"][value="con"])');
      await esperarResumen((await api('/panel?carta=con')).datos.resumen.visibles);
      assert.ok((await cartasVisibles()).every((c) => c === 'por_validar' || c === 'validada'));
      await p.click('label:has(> input[name="carta"][value=""])');
      await esperarResumen((await api('/panel')).datos.resumen.visibles);

      // CU-08: el coordinador abre la tarjeta, ve la carta y la valida → [Con carta].
      await (await tarjetaDelPanel(p, focoUgr.id)).locator('.foco-boton').click();
      await p.locator('#detalle-foco').waitFor();
      assert.equal(await p.textContent('#titulo'), 'Evaluación de riesgo');
      await p.locator('#carta-estado', { hasText: 'Por validar' }).waitFor();
      await p.click('#ver-carta');
      await p.locator('#carta-imagen').waitFor();
      assert.ok(await p.$eval('#carta-imagen', (i) => i.complete && i.naturalWidth > 0), 'la imagen de la carta se ve');
      await p.click('#validar-carta');
      await p.locator('#mensaje-carta', { hasText: '✔ Carta validada' }).waitFor();
      await p.locator('#carta-estado', { hasText: 'Con carta' }).waitFor();
      await p.screenshot({ path: `${CAPTURAS}10-carta-validada.png`, fullPage: true });
      await p.click('#tab-panel');
      await p.click('label:has(> input[name="carta"][value="con"])');
      await esperarResumen((await api('/panel?carta=con')).datos.resumen.visibles);
      assert.equal(await (await tarjetaDelPanel(p, focoUgr.id)).getAttribute('data-carta'), 'validada');

      // Rechazo con motivo (≥15): bloquea el despacho.
      const otro = focos.filter((_, i) => i % 3 === 0)[5];
      await p.click('label:has(> input[name="carta"][value=""])');
      await esperarResumen((await api('/panel')).datos.resumen.visibles);
      await (await tarjetaDelPanel(p, otro.id)).locator('.foco-boton').click();
      await p.locator('#carta-estado', { hasText: 'Por validar' }).waitFor();
      await p.fill('#motivo-rechazo', 'Falta la firma');
      assert.ok(await p.locator('#rechazar-carta').isDisabled(), 'rechazo bloqueado con 14 caracteres');
      await p.fill('#motivo-rechazo', 'Falta la firma del alcalde');
      await p.click('#rechazar-carta');
      await p.locator('#carta-estado', { hasText: 'Rechazada' }).waitFor();
      const despacho = await llamar('POST', `/incidentes/${otro.id}/asignaciones`, 'demo-coordinador', { brigadaId: BRIGADA(2) });
      assert.equal(despacho.estado, 422);

      // RF-08: el coordinador libera la brigada en liquidación.
      await p.click('#tab-panel');
      const b3 = p.locator(`#lista-brigadas li[data-id="${BRIGADA(3)}"]`);
      await b3.locator('.liberar').click();
      await p.locator(`#lista-brigadas li[data-id="${BRIGADA(3)}"][data-estado="Disponible"]`).waitFor();
      await ctx.close();
    });

    await paso('RNF-05: el panel se usa desde un teléfono de 360 px sin desbordar', async () => {
      const { ctx, p } = await entrarComo(navegador, 'demo-coordinador', { width: 360, height: 740 });
      await p.click('#tab-panel');
      await p.locator('#kanban .tarjeta-foco').first().waitFor();
      assert.ok(await sinDesbordeHorizontal(p), 'sin desplazamiento horizontal a 360 px');
      await p.screenshot({ path: `${CAPTURAS}11-panel-coed-360.png`, fullPage: false });
      await ctx.close();
    });

    // ---------------- Bolt 4: despacho en 1 clic, orden de salida, reactivación y reasignación ----------------
    let despachado;
    await paso('RF-10: despacho en 1 clic desde el panel; el doble clic no duplica la asignación', async () => {
      despachado = await focoSimulado(1, 2, true); // San Javier, 2 km: Alto, con carta
      const { ctx, p } = await entrarComo(navegador, 'demo-coordinador', { width: 1366, height: 900 });
      await p.click('#tab-panel');
      const t = await tarjetaDelPanel(p, despachado.id);
      const boton = t.locator('.despachar');
      assert.ok(await boton.isEnabled(), 'DESPACHAR habilitado: carta, contacto y brigada con jefe');
      assert.match(await boton.textContent(), /^DESPACHAR B\d · [\d.]+ km$/);
      await p.screenshot({ path: `${CAPTURAS}12-panel-despachar.png`, fullPage: false });
      await boton.dblclick();
      await p.locator(`#kanban .columna[data-columna="Asignado"] .tarjeta-foco[data-id="${despachado.id}"]`).waitFor();
      const historial = (await api(`/incidentes/${despachado.id}/historial`)).datos;
      assert.equal(historial.filter((h) => h.estadoNuevo === 'Asignado').length, 1, 'una sola asignación');
      despachado.brigada = (await api('/brigadas')).datos.find((b) => b.incidente && b.incidente.id === despachado.id);
      assert.ok(despachado.brigada, 'la brigada quedó vinculada al foco');
      // Sin suscripción push en el navegador del jefe: sale el SMS (pasarela simulada) y el panel lo muestra.
      await p.click('#actualizar-panel');
      await p.locator(`.tarjeta-foco[data-id="${despachado.id}"] .aviso[data-aviso="Enviada"]`).waitFor();
      const sms = (await api('/sms/mensajes')).datos.find((m) => m.texto.startsWith(`DESPACHO F-${despachado.id.slice(0, 8)}`));
      assert.ok(sms && sms.texto.length <= 160 && /Ref: Referente de ejemplo San Javier/.test(sms.texto), 'SMS de despacho ≤160');
      await ctx.close();
    });

    await paso('HU-4.2: el jefe ve la orden de salida (acuse de recibo) y confirma la llegada con GPS', async () => {
      // Sin permiso de GPS: no se registra nada y se pide avisar por radio (decisión del PO, 29/09/2026).
      const sinGps = await entrarComo(navegador, JEFE_DE[despachado.brigada.id], { width: 360, height: 740 });
      await sinGps.p.evaluate(() => {
        navigator.geolocation.getCurrentPosition = (_, error) => error({ code: 2, message: 'sin señal' });
      });
      await sinGps.p.locator('#orden-salida').waitFor();
      await sinGps.p.click('#confirmar-llegada');
      await sinGps.p.locator('#mensaje-llegada', { hasText: 'Avise su llegada por radio' }).waitFor();
      await sinGps.ctx.close();
      const antes = (await api(`/incidentes/${despachado.id}/historial`)).datos;
      assert.ok(!antes.some((h) => h.estadoNuevo === 'En_Atencion'), 'sin GPS no se registra la llegada');

      const punto = { latitude: -16.2747 + 2 / 111.195, longitude: -62.5064, accuracy: 10 };
      const { ctx, p } = await entrarComo(navegador, JEFE_DE[despachado.brigada.id], { width: 360, height: 740 }, {
        permissions: ['geolocation'],
        geolocation: punto,
      });
      await p.click('#tab-brigada');
      await p.locator('#orden-salida').waitFor();
      assert.match(await p.textContent('#orden-foco'), new RegExp(`FOCO-${despachado.id.slice(0, 8)} · riesgo Alto · San Javier`));
      assert.match(await p.textContent('#orden-ruta'), /Ruta en línea recta: [\d.]+ km al (N|NE|E|SE|S|SO|O|NO) desde/);
      assert.match(await p.getAttribute('#orden-llamar', 'href'), /^tel:\+591/);
      await p.locator('#estado-push', { hasText: 'SMS' }).waitFor(); // Chromium de pruebas sin servicio de push
      await p.screenshot({ path: `${CAPTURAS}13-orden-salida.png`, fullPage: true });
      // Acuse de recibo: el panel del coordinador lo ve como leída.
      for (let i = 0; i < 40; i++) {
        const t = (await api('/panel')).datos.incidentes.Asignado.find((x) => x.id === despachado.id);
        if (t && t.notificacion && t.notificacion.leida) break;
        await p.waitForTimeout(100);
        if (i === 39) assert.fail('la orden no quedó leída');
      }
      await p.click('#confirmar-llegada');
      await p.locator('#mensaje-llegada', { hasText: '✔ Llegada confirmada' }).waitFor();
      await p.locator('#estado-mi-brigada', { hasText: 'En combate activo' }).waitFor();
      assert.ok(await p.locator('#confirmar-llegada').isHidden(), 'la llegada no se confirma dos veces');
      // Termina el combate: la brigada reporta En Liquidación (su foco queda controlado).
      await p.click('#reportar-liquidacion');
      await p.locator('#estado-mi-brigada', { hasText: 'En liquidación' }).waitFor();
      await ctx.close();
    });

    await paso('Decisión 7.2 + HU-4.3: el foco controlado se reactiva y la brigada que lo liquidaba se reasigna en 1 clic', async () => {
      // Un reporte nuevo a 1 km del foco controlado: el panel avisa "posible reactivación" (no cambia nada solo).
      const alta = await llamar('POST', '/incidentes', 'demo-guardaparque', {
        id: crypto.randomUUID(),
        latitud: -16.2747 + 2.9 / 111.195,
        longitud: -62.5064,
        precisionMetros: 8,
      });
      assert.equal(alta.estado, 201);
      assert.ok(alta.datos.posibleReactivacion.some((x) => x.id === despachado.id), 'el reporte avisa la posible reactivación');

      const { ctx, p } = await entrarComo(navegador, 'demo-coordinador', { width: 1366, height: 900 });
      await p.click('#tab-panel');
      const controlada = p.locator(`#kanban .columna[data-columna="En_Liquidacion"] .tarjeta-foco[data-id="${despachado.id}"]`);
      await controlada.locator('.posible-reactivacion').waitFor();
      await controlada.locator('.foco-boton').click();
      await p.locator('#detalle-reactivar').waitFor();
      await p.fill('#justificacion-reactivar', 'Rebrote fuerte');
      assert.ok(await p.locator('#reactivar-foco').isDisabled(), 'reactivar bloqueado con 14 caracteres');
      await p.fill('#justificacion-reactivar', 'Rebrote fuerte con viento hacia San Javier');
      await p.click('#reactivar-foco');
      await p.locator('#detalle-reactivado', { hasText: 'Foco reactivado' }).waitFor();
      assert.equal(await p.textContent('#detalle-nivel'), 'Alto');

      await p.click('#tab-panel');
      const primera = p.locator('#kanban .columna[data-columna="Nuevo"] .tarjeta-foco').first();
      await p.locator(`#kanban .columna[data-columna="Nuevo"] .tarjeta-foco[data-id="${despachado.id}"] .reactivado`).waitFor();
      assert.equal(await primera.getAttribute('data-id'), despachado.id, 'el reactivado encabeza la columna Nuevo');
      const reasignar = primera.locator('.despachar');
      assert.match(await reasignar.textContent(), /^~ REASIGNAR B\d · [\d.]+ km$/);
      await p.screenshot({ path: `${CAPTURAS}14-reactivado-reasignar.png`, fullPage: false });
      await reasignar.click();
      await p.locator(`#kanban .columna[data-columna="Asignado"] .tarjeta-foco[data-id="${despachado.id}"]`).waitFor();
      const historial = (await api(`/incidentes/${despachado.id}/historial`)).datos;
      assert.equal(historial.at(-2).tipoEvento, 'Reactivacion');
      assert.match(historial.at(-1).justificacion, /Reasignación táctica confirmada por el coordinador/);
      await p.screenshot({ path: `${CAPTURAS}15-reasignado.png`, fullPage: false });
      await ctx.close();
    });

    // ---------------- Bolt 5: bitácora de turno y cierre institucional ----------------
    let enCampo;
    await paso('HU-5.2: el jefe llena la bitácora SIN conexión; queda en cola, sobrevive a recargar y se envía sola', async () => {
      // Foco en atención: despacho y llegada por API con una brigada Disponible y su jefe.
      enCampo = await focoSimulado(6, 2, true); // Roboré, 2 km: Alto, con carta
      const libre = (await api('/brigadas')).datos.find((b) => b.estadoOperativo === 'Disponible');
      assert.ok(libre, 'hay una brigada Disponible');
      enCampo.brigada = libre;
      const d = await llamar('POST', `/incidentes/${enCampo.id}/asignaciones`, 'demo-coordinador', { brigadaId: libre.id });
      assert.equal(d.estado, 201);
      const l = await llamar('POST', `/asignaciones/${d.datos.asignacion.id}/llegada`, JEFE_DE[libre.id], {
        latitud: enCampo.comunidad.latitud,
        longitud: enCampo.comunidad.longitud,
        precisionMetros: 10,
      });
      assert.equal(l.estado, 201);

      const { ctx, p } = await entrarComo(navegador, JEFE_DE[libre.id], { width: 360, height: 740 });
      await p.locator('#bitacora-turno').waitFor(); // el jefe entra directo a "Mi brigada"
      await p.evaluate(() => navigator.serviceWorker.ready);
      await ctx.setOffline(true);
      await p.click('label:has(> input[name="agua"][value="Critica"])');
      for (let i = 0; i < 3; i++) await p.click('button.paso[data-campo="control"][data-paso="10"]');
      for (let i = 0; i < 2; i++) await p.click('button.paso[data-campo="km"][data-paso="0.5"]');
      assert.equal(await p.textContent('#valor-control'), '30 %');
      assert.equal(await p.textContent('#valor-km'), '1 km');
      await p.click('#guardar-bitacora');
      const item = p.locator('#lista-bitacoras li.bitacora-item').first();
      await item.locator('.estado', { hasText: 'En cola' }).waitFor();
      const sms = (await item.locator('.texto-sms').textContent()).split('  (')[0];
      assert.match(sms, /^BRC1 B [\w-]{22} [\w-]{22} C O 1 1 30 [0-9a-z]+$/);
      await p.screenshot({ path: `${CAPTURAS}16-bitacora-sin-datos.png`, fullPage: true });
      // RNF-01: la app abre sin red, con la orden y la bitácora guardadas en el teléfono.
      await p.reload();
      await p.locator('#mensaje-brigada', { hasText: 'Sin conexión' }).waitFor();
      await p.locator('#lista-bitacoras li.bitacora-item .estado', { hasText: 'En cola' }).waitFor();
      assert.equal((await api(`/incidentes/${enCampo.id}/bitacoras`)).datos.length, 0, 'todavía no llegó al servidor');
      await ctx.setOffline(false);
      await p.locator('#lista-bitacoras li.bitacora-item .estado', { hasText: 'Enviada' }).waitFor({ timeout: 15000 });
      const remotas = (await api(`/incidentes/${enCampo.id}/bitacoras`)).datos;
      assert.equal(remotas.length, 1);
      assert.equal(remotas[0].nivelAgua, 'Critica');
      assert.equal(remotas[0].porcentajeControl, 30);
      await ctx.close();
    });

    await paso('HU-5.4: el coordinador cierra en 1 clic y descarga el informe consolidado en PDF', async () => {
      const { ctx, p } = await entrarComo(navegador, 'demo-coordinador', { width: 1366, height: 900 }, { acceptDownloads: true });
      await p.locator('#kanban .tarjeta-foco').first().waitFor(); // entra directo al panel
      const t = p.locator(`#kanban .columna[data-columna="En_Atencion"] .tarjeta-foco[data-id="${enCampo.id}"]`);
      await t.locator('.control', { hasText: '30 % control' }).waitFor();
      await t.locator('.foco-boton').click();
      await p.locator('#detalle-cierre').waitFor();
      await p.locator('#cierre-resumen', { hasText: '1 bitácora(s)' }).waitFor();
      // FE-1: Falso positivo exige 15 caracteres.
      await p.click('label:has(> input[name="resultado-cierre"][value="Falso_Positivo"])');
      await p.fill('#justificacion-cierre', 'Quema agrícola');
      assert.ok(await p.locator('#cerrar-incidente').isDisabled(), 'bloqueado con 14 caracteres');
      await p.fill('#justificacion-cierre', '');
      await p.click('label:has(> input[name="resultado-cierre"][value="Controlado"])');
      assert.ok(await p.locator('#cerrar-incidente').isEnabled());
      await p.screenshot({ path: `${CAPTURAS}17-cierre.png`, fullPage: false });
      const [descarga] = await Promise.all([p.waitForEvent('download'), p.click('#cerrar-incidente')]);
      assert.equal(descarga.suggestedFilename(), `informe-FOCO-${enCampo.id.slice(0, 8)}.pdf`);
      const pdf = readFileSync(await descarga.path()).toString('latin1');
      assert.ok(pdf.startsWith('%PDF-1.4'), 'es un PDF');
      for (const texto of ['Informe Técnico Consolidado de Incidente', 'Resultado: Controlado', '6. Bitácoras de turno', 'Crítica']) {
        assert.ok(pdf.includes(texto), `el PDF contiene "${texto}"`);
      }
      await p.locator('#detalle-informe').waitFor();
      assert.match(await p.textContent('#informe-sha'), /^[0-9a-f]{64}$/);
      await p.screenshot({ path: `${CAPTURAS}18-informe.png`, fullPage: false });
      await p.click('#tab-informes');
      const item = p.locator(`#lista-informes li[data-id="${enCampo.id}"]`);
      await item.waitFor();
      assert.match(await item.textContent(), /Controlado/);
      assert.match(await p.textContent('#kpi-informes'), /focos? cerrados? · \d+ falsos? positivos? · ΔT promedio/);
      await p.screenshot({ path: `${CAPTURAS}19-informes.png`, fullPage: false });
      await ctx.close();
    });

    await paso('RS-01: memoria de la app dentro del presupuesto de 120 MB', async () => {
      // 1) Heap JS de la app tras usar todo el flujo (incluida la compresión de una foto de 1600×1200).
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
      const heapMB = m.JSHeapUsedSize / 1048576;
      console.log(`    heap JS tras el flujo completo: ${heapMB.toFixed(1)} MB (asignado ${(m.JSHeapTotalSize / 1048576).toFixed(1)} MB)`);
      assert.ok(heapMB < 120, `heap ${heapMB} MB`);

      // 2) Memoria residente que agrega la app sobre el propio motor del navegador: RSS del renderizador con la
      //    app cargada menos el de una página HTML mínima. En Chromium de escritorio el motor solo ya ocupa
      //    ~100 MB, así que el RSS absoluto no representa al Android de 1 GB; esa medición final se hace en el
      //    dispositivo de referencia (queda como tarea de campo del Bolt 1).
      await contexto.close();
      // Solo los renderizadores de ESTE navegador (vía CDP), no los del Chrome personal que esté abierto.
      const sesionNavegador = await navegador.newBrowserCDPSession();
      const rssMaximoRenderer = async () => {
        const { processInfo } = await sesionNavegador.send('SystemInfo.getProcessInfo');
        const pids = processInfo.filter((x) => x.type === 'renderer').map((x) => x.id);
        const salida =
          process.platform === 'win32'
            ? execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pids.join(',')}).WorkingSet64"`, { encoding: 'utf8' })
            : execSync(`ps -o rss= -p ${pids.join(',')}`, { encoding: 'utf8' });
        const mb = salida
          .trim()
          .split(/\s+/)
          .map((v) => parseInt(v, 10) / (process.platform === 'win32' ? 1048576 : 1024));
        return Math.max(...mb);
      };
      const medir = async (preparar) => {
        const ctx = await navegador.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, sinVideo: true });
        const p = await ctx.newPage();
        await preparar(ctx, p);
        await p.waitForTimeout(1500);
        const mb = await rssMaximoRenderer();
        await ctx.close();
        return mb;
      };
      const base = await medir(async (_, p) => {
        await p.goto('data:text/html,<meta name=viewport content="width=device-width"><h1>Base</h1>');
      });
      const conApp = await medir(async (ctx, p) => {
        await ctx.addInitScript(() => {
          localStorage.setItem('brc.token', JSON.stringify('demo-guardaparque'));
          localStorage.setItem('brc.usuario', JSON.stringify({ nombre: 'Guardaparque (demo)', rol: 'Guardaparque' }));
        });
        await p.goto(APP);
        await p.waitForFunction(() => document.getElementById('version-catalogo').textContent === '7 comunidades');
      });
      const agregado = conApp - base;
      console.log(`    RSS renderizador: página mínima ${base.toFixed(0)} MB, con la app ${conApp.toFixed(0)} MB → la app agrega ${agregado.toFixed(0)} MB`);
      assert.ok(agregado < 120, `la app agrega ${agregado} MB`);
    });
  } finally {
    await navegador.close();
    // Los videos se nombran por orden de aparición (video-01.webm, …) en lugar del nombre aleatorio de Playwright.
    for (const [i, video] of videos.entries()) {
      const destino = `${CAPTURAS}videos${sep}video-${String(i + 1).padStart(2, '0')}.webm`;
      if (video) renameSync(await video.path(), destino);
    }
    const fallidos = resultados.filter((r) => !r.ok).length;
    console.log(`\n${resultados.length - fallidos}/${resultados.length} pasos OK. Capturas en ${CAPTURAS}`);
    if (fallidos) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
