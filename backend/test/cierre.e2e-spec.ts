import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { codificarReporte, uuidACorto } from '../src/core/sync/sms/codec-sms';
import { BRIGADAS, COMUNIDADES, USUARIOS_DEMO } from '../src/semilla';
import { Cliente, crearAppPruebas, subirCarta, TOKENS } from './app-pruebas';

/**
 * DoD del Bolt 5 (Release 0.6): bitácora y cierre institucional.
 * 1) El checklist persiste con timestamp y se sincroniza en <1 KB (idempotente, append-only, también por SMS).
 * 2) Informe consolidado en PDF inmutable en 1 clic.
 * 3) Justificación obligatoria en cierres "Falso positivo".
 * HU-5.2, HU-5.4, RF-12, RF-13, RS-02, RNF-07. Requiere PostgreSQL.
 */
describe('Bitácora y cierre institucional (Bolt 5)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let guardaparque: Cliente;
  let coordinador: Cliente;
  let ugr: Cliente;
  let jefe3: Cliente;
  let jefe1: Cliente;
  let jefe4: Cliente;
  let dirArchivos: string;
  const SECRETO_SMS = 'secreto-sms-solo-desarrollo';

  const [, , B3, B4] = BRIGADAS.map((b) => b.id);
  const telefonoJefe3 = USUARIOS_DEMO.find((u) => u.token === 'demo-jefe-brigada')!.telefono;
  const alNorte = (c: { latitud: number; longitud: number }, km: number) => ({
    latitud: c.latitud + km / 111.195,
    longitud: c.longitud,
    precisionMetros: 8,
  });
  const reportar = async (punto: object): Promise<string> => {
    const id = randomUUID();
    await guardaparque
      .post('/api/incidentes')
      .send({ id, ...punto, fechaReporte: new Date(Date.now() - 90 * 60000).toISOString() })
      .expect(201);
    return id;
  };
  /** Foco con carta, despachado a la brigada y con llegada confirmada: "En atención". */
  const focoEnAtencion = async (punto: object, brigada: string, jefe: Cliente) => {
    const id = await reportar(punto);
    await subirCarta(ugr, id).expect(201);
    const d = await coordinador.post(`/api/incidentes/${id}/asignaciones`).send({ brigadaId: brigada }).expect(201);
    await jefe.post(`/api/asignaciones/${d.body.asignacion.id}/llegada`).send(punto).expect(201);
    return id;
  };
  const checklist = (extra: object = {}) => ({
    id: randomUUID(),
    fecha: new Date().toISOString(),
    nivelAgua: 'Suficiente',
    nivelCombustible: 'OK',
    herramientasOperativas: true,
    kmFajaMitigados: 1.5,
    porcentajeControl: 40,
    ...extra,
  });
  const smsEntrante = (de: string, texto: string) =>
    request(app.getHttpServer()).post('/api/sms/entrante').set('x-sms-secreto', SECRETO_SMS).send({ de, texto });
  const descargarPdf = (cliente: Cliente, id: string) =>
    cliente
      .get(`/api/incidentes/${id}/informe/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const partes: Buffer[] = [];
        r.on('data', (d: Buffer) => partes.push(d));
        r.on('end', () => cb(null, Buffer.concat(partes)));
      });
  const estadoBrigada = async (id: string) =>
    ((await coordinador.get('/api/brigadas').expect(200)).body as Array<{ id: string; estadoOperativo: string }>).find(
      (b) => b.id === id,
    )!.estadoOperativo;

  beforeAll(async () => {
    dirArchivos = mkdtempSync(join(tmpdir(), 'cierre-'));
    process.env.EVIDENCIAS_DIR = dirArchivos;
    const pruebas = await crearAppPruebas();
    app = pruebas.app;
    ds = pruebas.ds;
    guardaparque = pruebas.como(TOKENS.guardaparque);
    coordinador = pruebas.como(TOKENS.coordinador);
    ugr = pruebas.como(TOKENS.ugr);
    jefe3 = pruebas.como(TOKENS.jefeBrigada);
    jefe1 = pruebas.como(TOKENS.jefe1);
    jefe4 = pruebas.como(TOKENS.jefe4);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('DoD 1 / HU-5.2: bitácora de turno por checklist', () => {
    let foco: string;
    let focoB4: string;
    const primera = checklist();

    beforeAll(async () => {
      foco = await focoEnAtencion(alNorte(COMUNIDADES[2], 2), B3, jefe3);
    });

    it('solo antes del cierre y después de la llegada, y solo el jefe de la brigada asignada', async () => {
      const sinLlegada = await reportar(alNorte(COMUNIDADES[0], 2));
      focoB4 = sinLlegada;
      await jefe3.post(`/api/incidentes/${sinLlegada}/bitacoras`).send(checklist()).expect(409);
      await guardaparque.post(`/api/incidentes/${foco}/bitacoras`).send(checklist()).expect(403);
      await coordinador.post(`/api/incidentes/${foco}/bitacoras`).send(checklist()).expect(403);
      await jefe1.post(`/api/incidentes/${foco}/bitacoras`).send(checklist()).expect(403);
      // El foco sin llegada (Nuevo): 409 por estado.
      await subirCarta(ugr, sinLlegada).expect(201);
      const d = await coordinador.post(`/api/incidentes/${sinLlegada}/asignaciones`).send({ brigadaId: B4 }).expect(201);
      await jefe4.post(`/api/incidentes/${sinLlegada}/bitacoras`).send(checklist()).expect(409);
      await jefe4.post(`/api/asignaciones/${d.body.asignacion.id}/llegada`).send(alNorte(COMUNIDADES[0], 2)).expect(201);
    });

    it('persiste con el timestamp del teléfono, en <1 KB, y el reintento no duplica', async () => {
      expect(Buffer.byteLength(JSON.stringify(primera))).toBeLessThan(1024);
      const res = await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send(primera).expect(201);
      expect(res.body).toMatchObject({
        id: primera.id,
        nivelAgua: 'Suficiente',
        porcentajeControl: 40,
        controlRetrocede: false,
        canal: 'App',
        brigada: 'Brigada Departamental 3',
      });
      expect(new Date(res.body.fecha).toISOString()).toBe(primera.fecha);
      await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send(primera).expect(200);
      expect(await ds.query('SELECT count(*)::int AS n FROM bitacora WHERE id = $1', [primera.id])).toEqual([{ n: 1 }]);
      // El mismo id en otro foco no se confunde con un reintento.
      await jefe4.post(`/api/incidentes/${focoB4}/bitacoras`).send(primera).expect(409);
    });

    it('es un checklist: rechaza texto libre y valores fuera del catálogo', async () => {
      await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send({ ...checklist(), descripcion: 'todo tranquilo' }).expect(400);
      await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send(checklist({ nivelAgua: 'Poca' })).expect(400);
      await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send(checklist({ porcentajeControl: 120 })).expect(400);
    });

    it('RNF-07: inmutable una vez guardada (append-only en la BD)', async () => {
      await expect(ds.query('UPDATE bitacora SET porcentaje_control = 99 WHERE id = $1', [primera.id])).rejects.toThrow(
        /inmutable/,
      );
      await expect(ds.query('DELETE FROM bitacora WHERE id = $1', [primera.id])).rejects.toThrow(/inmutable/);
    });

    it('decisión 7.4: si el % de control baja se acepta y queda marcado', async () => {
      const res = await jefe3
        .post(`/api/incidentes/${foco}/bitacoras`)
        .send(checklist({ porcentajeControl: 30, nivelAgua: 'Critica', herramientasOperativas: false }))
        .expect(201);
      expect(res.body.controlRetrocede).toBe(true);
    });

    it('decisión 7.5: la bitácora también llega por SMS (BRC1 B) desde el teléfono del jefe, sin duplicar', async () => {
      const b = {
        tipo: 'B' as const,
        incidenteId: foco,
        id: randomUUID(),
        aguaSuficiente: true,
        combustibleOk: false,
        herramientasOperativas: true,
        kmFajaMitigados: 3.5,
        porcentajeControl: 60,
        // El SMS lleva la hora en segundos: se usa una posterior a las bitácoras anteriores.
        fecha: new Date(Date.now() + 2000),
      };
      const texto = codificarReporte(b);
      expect(texto.length).toBeLessThanOrEqual(90);
      const res = await smsEntrante(telefonoJefe3, texto).expect(200);
      expect(res.body).toMatchObject({ estado: 'Procesado', duplicado: false, bitacora: { canal: 'SMS', porcentajeControl: 60, nivelCombustible: 'Reserva' } });
      expect(res.body.respuesta).toMatch(/^BRC1 OK B .* Control 60% registrado$/);
      expect((await smsEntrante(telefonoJefe3, texto).expect(200)).body.duplicado).toBe(true);
      const ajeno = await smsEntrante('+59170009999', texto.replace(uuidACorto(b.id), uuidACorto(randomUUID()))).expect(200);
      expect(ajeno.body).toMatchObject({ estado: 'Rechazado' });
    });

    it('el coordinador ve las bitácoras en orden y el panel muestra el último % de control', async () => {
      const lista = (await coordinador.get(`/api/incidentes/${foco}/bitacoras`).expect(200)).body;
      expect(lista.map((b: { porcentajeControl: number }) => b.porcentajeControl)).toEqual([40, 30, 60]);
      await jefe1.get(`/api/incidentes/${foco}/bitacoras`).expect(403);
      const panel = (await coordinador.get('/api/panel').expect(200)).body;
      const tarjeta = panel.incidentes.En_Atencion.find((t: { id: string }) => t.id === foco);
      expect(tarjeta.porcentajeControl).toBe(60);
    });

    describe('DoD 2 / HU-5.4: cierre en 1 clic con informe PDF inmutable', () => {
      let informe: { sha256: string; url: string; tiempoTotalDespacho: number };

      it('solo el coordinador cierra; "Controlado" exige que haya habido llegada', async () => {
        await ugr.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Controlado' }).expect(403);
        const nuevo = await reportar(alNorte(COMUNIDADES[5], 2));
        await coordinador.post(`/api/incidentes/${nuevo}/cierre`).send({ resultado: 'Controlado' }).expect(409);
        await coordinador.post(`/api/incidentes/${nuevo}/cierre`).send({ resultado: 'Extendido' }).expect(409);
        await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Apagado' }).expect(400);
      });

      it('cierra, libera la brigada (decisión 7.3) y genera el informe con ΔT y bitácoras', async () => {
        const res = await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Controlado' }).expect(201);
        informe = res.body;
        expect(res.body).toMatchObject({ incidenteId: foco, resultado: 'Controlado', justificacionFalsoPositivo: null });
        expect(res.body.tiempoTotalDespacho).toBeGreaterThanOrEqual(89);
        expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(res.body.url).toBe(`/api/incidentes/${foco}/informe/pdf`);
        expect((await coordinador.get(`/api/incidentes/${foco}`).expect(200)).body.estado).toBe('Cerrado');
        expect(await estadoBrigada(B3)).toBe('Disponible');
        const historial = (await coordinador.get(`/api/incidentes/${foco}/historial`).expect(200)).body;
        expect(historial.at(-1)).toMatchObject({ estadoAnterior: 'En_Atencion', estadoNuevo: 'Cerrado' });
      });

      it('el PDF se descarga íntegro (Coordinador y UGR) y contiene el ciclo completo', async () => {
        for (const cliente of [coordinador, ugr]) {
          const res = await descargarPdf(cliente, foco).expect(200);
          const pdf = res.body as Buffer;
          expect(res.headers['content-type']).toBe('application/pdf');
          expect(res.headers['content-disposition']).toBe(`attachment; filename="informe-FOCO-${foco.slice(0, 8)}.pdf"`);
          expect(createHash('sha256').update(pdf).digest('hex')).toBe(informe.sha256);
          expect(res.headers['x-informe-sha256']).toBe(informe.sha256);
          const texto = pdf.toString('latin1');
          expect(texto.startsWith('%PDF-1.4')).toBe(true);
          for (const esperado of [
            '(Informe Técnico Consolidado de Incidente) Tj',
            'Resultado: Controlado',
            'Brigada Departamental 3',
            'Carta municipal: Recibida',
            'Delta T \\(reporte -> llegada\\)',
            '6. Bitácoras de turno',
            '30 %!',
            'SMS',
          ]) {
            expect(texto).toContain(esperado);
          }
        }
        await guardaparque.get(`/api/incidentes/${foco}/informe/pdf`).expect(403);
        await jefe3.get(`/api/incidentes/${foco}/informe`).expect(403);
      });

      it('RNF-07: el informe es inmutable (segundo cierre 409, BD append-only, archivo cifrado)', async () => {
        await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Extendido' }).expect(409);
        await expect(ds.query(`UPDATE informe_consolidado SET sha256 = repeat('0', 64)`)).rejects.toThrow(/inmutable/);
        await expect(ds.query('DELETE FROM informe_consolidado')).rejects.toThrow(/inmutable/);
        const archivo = readdirSync(dirArchivos).find((f) => f.startsWith(`informe-${foco}`))!;
        expect(readFileSync(join(dirArchivos, archivo)).includes(Buffer.from('%PDF'))).toBe(false);
        // Cerrado: ya no admite bitácoras.
        await jefe3.post(`/api/incidentes/${foco}/bitacoras`).send(checklist()).expect(409);
      });
    });
  });

  describe('DoD 3 / FE-1: "Falso positivo" exige justificación', () => {
    it('sin justificación o con 14 caracteres: 400; con 15 o más se cierra incluso sin despacho', async () => {
      const foco = await reportar(alNorte(COMUNIDADES[6], 3));
      await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Falso_Positivo' }).expect(400);
      await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Falso_Positivo', justificacion: '  quema chica   ' }).expect(400);
      await coordinador.post(`/api/incidentes/${foco}/cierre`).send({ resultado: 'Falso_Positivo', justificacion: 'Quema agrícola' }).expect(400);
      const res = await coordinador
        .post(`/api/incidentes/${foco}/cierre`)
        .send({ resultado: 'Falso_Positivo', justificacion: 'Quema agrícola autorizada por la ABT' })
        .expect(201);
      expect(res.body).toMatchObject({ resultado: 'Falso_Positivo', tiempoTotalDespacho: null, justificacionFalsoPositivo: 'Quema agrícola autorizada por la ABT' });
      const texto = ((await descargarPdf(ugr, foco).expect(200)).body as Buffer).toString('latin1');
      expect(texto).toContain('Resultado: Falso positivo');
      expect(texto).toContain('Justificación del falso positivo: Quema agrícola autorizada por la ABT');
      expect(texto).toContain('No se despachó ninguna brigada.');
      const auditoria = await ds.query(`SELECT detalle FROM evento_auditoria WHERE tipo = 'IncidenteCerrado' AND incidente_id = $1`, [foco]);
      expect(auditoria[0].detalle).toMatch(/^Cierre Falso_Positivo: Quema agrícola autorizada por la ABT · informe SHA-256 [0-9a-f]{64}$/);
    });
  });

  describe('Decisión 7.3 y listado de informes', () => {
    it('no libera una brigada que ya fue reasignada a otro foco', async () => {
      // B4 atendía el foco de San Javier (despachado en el primer bloque): pasa a En Liquidación y se reasigna.
      const [fila] = await ds.query(
        `SELECT incidente_id FROM asignacion_despacho WHERE brigada_id = $1 ORDER BY fecha_asignacion DESC LIMIT 1`,
        [B4],
      );
      const anterior = fila.incidente_id;
      await jefe4.post(`/api/brigadas/${B4}/estado`).send({ estado: 'En_Liquidacion' }).expect(200);
      const nuevo = await reportar(alNorte(COMUNIDADES[0], 3));
      await subirCarta(ugr, nuevo).expect(201);
      const s = (await coordinador.get(`/api/incidentes/${nuevo}/brigadas-sugeridas`).expect(200)).body;
      expect(s[0]).toMatchObject({ id: B4, reasignacion: true });
      await coordinador.post(`/api/incidentes/${nuevo}/asignaciones`).send({ brigadaId: B4 }).expect(201);
      await coordinador.post(`/api/incidentes/${anterior}/cierre`).send({ resultado: 'Extendido' }).expect(201);
      expect(await estadoBrigada(B4)).toBe('En_Desplazamiento');
    });

    it('GET /api/informes lista los cerrados con el resumen del KPI (Coordinador y UGR)', async () => {
      const res = await ugr.get('/api/informes').expect(200);
      expect(res.body.informes).toHaveLength(3);
      expect(res.body.resumen).toMatchObject({ total: 3, falsosPositivos: 1, conLlegada: 2, lineaBaseMin: 180, metaAhorroPct: 30 });
      expect(res.body.resumen.deltaPromedioMin).toBeGreaterThan(0);
      await jefe3.get('/api/informes').expect(403);
    });
  });
});
