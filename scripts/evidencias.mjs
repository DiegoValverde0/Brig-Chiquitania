#!/usr/bin/env node
/*
 * Corre todas las pruebas del MVP y deja las evidencias en `evidencias/`, con `RESUMEN.md` como portada.
 * Solo requiere Node 22 y Docker (sin bash, WSL ni curl): funciona igual en Windows (PowerShell), macOS y Linux.
 *
 *   node scripts/evidencias.mjs                          todos los pasos
 *   node scripts/evidencias.mjs --solo e2e,navegador     solo algunos pasos
 *   node scripts/evidencias.mjs --seguir                 no detenerse en el primer paso fallido
 *
 * Pasos: health, unitarias, e2e, flujo, inmutabilidad, navegador. Requiere `docker compose up -d --build` y
 * `npm ci` en backend/ y frontend/pruebas/ (ver GUIA_DESARROLLO.md §4). La prueba del navegador y el flujo
 * despachan brigadas: por eso cada uno aplica antes la semilla (deja las 4 brigadas Disponibles).
 * Variables opcionales: API (por defecto http://localhost:3000/api), APP (http://localhost:8080) y API_LOCAL=1 si
 * la API corre fuera de Docker (la semilla se aplica entonces con `node dist/seed` en backend/).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { release, type } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SALIDA = join(RAIZ, 'evidencias');
const BACKEND = join(RAIZ, 'backend');
const PRUEBAS_WEB = join(RAIZ, 'frontend', 'pruebas');
const API = process.env.API ?? 'http://localhost:3000/api';
const APP = process.env.APP ?? 'http://localhost:8080';
const NODE = process.execPath;
const JEST = join(BACKEND, 'node_modules', 'jest', 'bin', 'jest.js');

const args = process.argv.slice(2);
const indiceSolo = args.indexOf('--solo');
const solo = indiceSolo >= 0 ? (args[indiceSolo + 1] ?? '').split(',').filter(Boolean) : null;
const seguir = args.includes('--seguir');

const sinColores = (t) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/** Ejecuta un comando mostrando su salida en vivo y la devuelve completa (sin shell: rutas con espacios seguras). */
function ejecutar(comando, argumentos, { cwd = RAIZ, env = {}, entrada } = {}) {
  return new Promise((resolver) => {
    const hijo = spawn(comando, argumentos, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let salida = '';
    const recibir = (d) => {
      const texto = d.toString('utf8');
      salida += texto;
      process.stdout.write(texto);
    };
    hijo.stdout.on('data', recibir);
    hijo.stderr.on('data', recibir);
    hijo.on('error', (e) => {
      salida += `\nNo se pudo ejecutar "${comando}": ${e.message}\n`;
      resolver({ codigo: -1, salida: sinColores(salida) });
    });
    hijo.on('close', (codigo) => resolver({ codigo, salida: sinColores(salida) }));
    hijo.stdin.end(entrada ?? '');
  });
}

const guardar = (archivo, texto) => writeFileSync(join(SALIDA, archivo), texto, 'utf8');
const totalesJest = (salida) => {
  const m = salida.match(/^Tests:\s+(.*)$/m);
  return m ? m[1].trim() : 'sin resumen de Jest';
};
// Con API_LOCAL=1 (API corriendo fuera de Docker, GUIA §4.3) la semilla se aplica con el backend local.
const semilla = () =>
  process.env.API_LOCAL === '1'
    ? ejecutar(NODE, ['dist/seed'], { cwd: BACKEND })
    : ejecutar('docker', ['compose', 'exec', '-T', 'api', 'node', 'dist/seed']);

// Cada paso devuelve { ok, detalle } y deja su archivo de evidencia.
const PASOS = [
  {
    id: 'health',
    nombre: 'API y base de datos en marcha',
    archivo: '00-health.txt',
    async correr() {
      try {
        const res = await fetch(`${API}/health`);
        const cuerpo = await res.text();
        guardar(this.archivo, `GET ${API}/health → HTTP ${res.status}\n${cuerpo}\n`);
        console.log(`GET ${API}/health → ${res.status} ${cuerpo}`);
        return { ok: res.ok && /"db":"up"/.test(cuerpo), detalle: cuerpo };
      } catch (e) {
        const texto = `No responde ${API}/health (${e.cause?.code ?? e.message}). ¿Corrió "docker compose up -d --build"?`;
        guardar(this.archivo, texto + '\n');
        console.log(texto);
        return { ok: false, detalle: 'la API no responde' };
      }
    },
  },
  {
    id: 'unitarias',
    nombre: 'Pruebas unitarias (Jest) con cobertura',
    archivo: '01-unitarias.txt',
    async correr() {
      const r = await ejecutar(NODE, [JEST, '--verbose', '--coverage', `--coverageDirectory=${join(SALIDA, 'cobertura')}`], {
        cwd: BACKEND,
      });
      guardar(this.archivo, r.salida);
      return { ok: r.codigo === 0, detalle: `${totalesJest(r.salida)} · cobertura en cobertura/lcov-report/index.html` };
    },
  },
  {
    id: 'e2e',
    nombre: 'Pruebas e2e de la API contra PostgreSQL (Bolts 0 a 5)',
    archivo: '02-e2e.txt',
    async correr() {
      const r = await ejecutar(NODE, [JEST, '--config', 'test/jest-e2e.json', '--runInBand', '--verbose'], { cwd: BACKEND });
      guardar(this.archivo, r.salida);
      return { ok: r.codigo === 0, detalle: `${totalesJest(r.salida)} (base chiquitania_test)` };
    },
  },
  {
    id: 'flujo',
    nombre: 'Flujo completo por API: reporte → despacho → llegada → bitácora → cierre PDF',
    archivo: '03-flujo-api.txt',
    async correr() {
      const s = await semilla();
      const r = await ejecutar(NODE, [join(BACKEND, 'scripts', 'flujo-e2e.mjs')], { env: { API } });
      guardar(this.archivo, `$ semilla\n${s.salida}\n$ node backend/scripts/flujo-e2e.mjs\n${r.salida}`);
      const pasos = (r.salida.match(/^\d\)/gm) ?? []).length;
      return { ok: s.codigo === 0 && r.codigo === 0, detalle: `${pasos}/9 pasos` };
    },
  },
  {
    id: 'inmutabilidad',
    nombre: 'RNF-07: la base rechaza modificar o borrar la auditoría',
    archivo: '04-inmutabilidad.txt',
    async correr() {
      const psql = (sql) =>
        ejecutar('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'chiquitania', '-d', 'chiquitania_db', '-v', 'ON_ERROR_STOP=1'], {
          entrada: sql + '\n',
        });
      let texto = '$ Filas existentes (sin filas, un trigger FOR EACH ROW no tiene nada que rechazar: correr antes el paso "flujo")\n';
      const conteo = await psql(
        'SELECT (SELECT count(*) FROM bitacora) AS bitacoras, (SELECT count(*) FROM informe_consolidado) AS informes, (SELECT count(*) FROM historial_estado) AS historial;',
      );
      texto += conteo.salida + '\n';
      const intentos = [
        'UPDATE bitacora SET porcentaje_control = 99;',
        "UPDATE informe_consolidado SET sha256 = repeat('0', 64);",
        'DELETE FROM historial_estado;',
        'TRUNCATE bitacora;',
      ];
      let rechazados = 0;
      for (const sql of intentos) {
        const r = await psql(sql);
        const rechazado = r.codigo !== 0 && /RNF-07/.test(r.salida);
        if (rechazado) rechazados++;
        texto += `$ ${sql}\n${r.salida.trim()}\n→ ${rechazado ? 'RECHAZADO (correcto)' : 'NO fue rechazado'}\n\n`;
      }
      const hayFilas = /\n\s*[1-9]\d*\s*\|\s*[1-9]\d*\s*\|\s*[1-9]\d*/.test(conteo.salida);
      if (!hayFilas) texto += 'Advertencia: alguna tabla está vacía; corra el paso "flujo" y repita este paso.\n';
      guardar(this.archivo, texto);
      console.log(texto);
      return { ok: rechazados === intentos.length && hayFilas, detalle: `${rechazados}/${intentos.length} intentos rechazados` };
    },
  },
  {
    id: 'navegador',
    nombre: 'App web en Chrome real (Playwright): 18 pasos de los Bolts 1 a 5',
    archivo: '05-navegador.txt',
    async correr() {
      const s = await semilla();
      const capturasOrigen = join(PRUEBAS_WEB, 'capturas');
      rmSync(capturasOrigen, { recursive: true, force: true });
      const r = await ejecutar(NODE, ['app.prueba.mjs'], { cwd: PRUEBAS_WEB, env: { APP } });
      guardar(this.archivo, `$ semilla\n${s.salida}\n$ node app.prueba.mjs (APP=${APP})\n${r.salida}`);
      rmSync(join(SALIDA, 'capturas'), { recursive: true, force: true });
      if (existsSync(capturasOrigen)) cpSync(capturasOrigen, join(SALIDA, 'capturas'), { recursive: true });
      const m = r.salida.match(/(\d+)\/(\d+) pasos OK/);
      return { ok: s.codigo === 0 && r.codigo === 0, detalle: `${m ? m[0] : 'sin resumen'} · capturas en capturas/` };
    },
  },
];

async function main() {
  const desconocidos = (solo ?? []).filter((id) => !PASOS.some((p) => p.id === id));
  if (desconocidos.length) {
    console.error(`Paso desconocido: ${desconocidos.join(', ')}. Pasos válidos: ${PASOS.map((p) => p.id).join(', ')}`);
    process.exit(2);
  }
  if (!existsSync(JEST)) {
    console.error('Falta instalar las dependencias del backend: cd backend; npm ci');
    process.exit(2);
  }
  mkdirSync(SALIDA, { recursive: true });
  const inicio = new Date();
  const resultados = [];
  for (const paso of PASOS) {
    if (solo && !solo.includes(paso.id)) continue;
    console.log(`\n══════ ${paso.nombre} ══════`);
    const t0 = Date.now();
    const r = await paso.correr();
    resultados.push({ ...paso, ...r, segundos: Math.round((Date.now() - t0) / 1000) });
    console.log(`\n→ ${r.ok ? '✅' : '❌'} ${paso.nombre}: ${r.detalle}`);
    if (!r.ok && !seguir) {
      console.log('Se detiene aquí (use --seguir para continuar con los demás pasos).');
      break;
    }
  }

  const commit = (await ejecutar('git', ['log', '-1', '--format=%h %s'])).salida.trim();
  const resumen = [
    '# Evidencias de pruebas — Brig-Chiquitania MVP',
    '',
    `- **Fecha:** ${inicio.toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} (hora de Bolivia)`,
    `- **Commit:** ${commit}`,
    `- **Entorno:** Node ${process.version} · ${type()} ${release()} · API ${API} · App ${APP}`,
    '',
    '| Paso | Resultado | Detalle | Tiempo | Evidencia |',
    '|---|---|---|---|---|',
    ...resultados.map(
      (r) => `| ${r.nombre} | ${r.ok ? '✅ OK' : '❌ FALLA'} | ${r.detalle} | ${r.segundos} s | [${r.archivo}](${r.archivo}) |`,
    ),
    '',
    'Esperado: unitarias 76/76, e2e 94/94, flujo 9/9, inmutabilidad 4/4 rechazos, navegador 18/18.',
    '',
  ].join('\n');
  // Con --solo se conserva el resumen anterior y se agrega uno parcial.
  guardar(solo ? `RESUMEN-${solo.join('-')}.md` : 'RESUMEN.md', resumen);
  console.log(`\n${resumen}\nEvidencias en: ${SALIDA}`);
  if (resultados.some((r) => !r.ok)) process.exitCode = 1;
}

main();
