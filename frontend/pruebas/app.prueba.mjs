/*
 * Prueba de la app web (CU-01) en Chromium real, contra una API en marcha con la semilla aplicada y
 * FRONTEND_DIR apuntando a frontend/app (o detrás de nginx).
 *
 *   APP=http://localhost:3000 node app.prueba.mjs
 *
 * Cubre la DoD del Bolt 1 desde el teléfono: reporte GPS con foto comprimida ≤100 KB, contacto comunal
 * autocompletado offline, reporte sin datos (cola en IndexedDB + SMS ≤160) que sobrevive a recargar la app sin
 * red y se sincroniza solo al volver la señal, envío por la pasarela SMS simulada y consumo de memoria (RS-01).
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';

const APP = process.env.APP ?? 'http://localhost:3000';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const CERCA_DE_CONCEPCION = { latitude: -16.1153, longitude: -62.0258, accuracy: 8 };
const CAPTURAS = new URL('./capturas/', import.meta.url).pathname;

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

const tarjeta = (pagina, texto) => pagina.locator('#lista-reportes li.reporte', { hasText: texto }).first();

async function main() {
  mkdirSync(CAPTURAS, { recursive: true });
  const navegador = await chromium.launch({ executablePath: CHROMIUM });
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
      await pagina.check('input[name="modo"][value="Distancia"]');
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
      await pagina.check('input[name="modo"][value="GPS"]');
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
      await item.locator('button').click();
      await p.locator('#detalle-foco').waitFor();
      assert.match(await p.textContent('#detalle-justificacion'), /Comunidad habitada en el área de influencia: Concepción/);
      assert.match(await p.textContent('#detalle-distancia'), /Distancia a comunidad: 10 km \(Concepción\)/);
      assert.ok(await p.locator('input[name="nivel"][value="Medio"]').isDisabled(), 'no se puede elegir el nivel vigente');

      await p.check('input[name="nivel"][value="Alto"]');
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
      const rssMaximoRenderer = () =>
        Math.max(
          ...execSync("ps -eo rss,args | grep -- '--type=renderer' | grep -v grep", { encoding: 'utf8' })
            .trim()
            .split('\n')
            .map((l) => parseInt(l.trim(), 10) / 1024),
        );
      const medir = async (preparar) => {
        const ctx = await navegador.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1 });
        const p = await ctx.newPage();
        await preparar(ctx, p);
        await p.waitForTimeout(1500);
        const mb = rssMaximoRenderer();
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
    const fallidos = resultados.filter((r) => !r.ok).length;
    console.log(`\n${resultados.length - fallidos}/${resultados.length} pasos OK. Capturas en ${CAPTURAS}`);
    if (fallidos) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
