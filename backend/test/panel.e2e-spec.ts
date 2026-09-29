import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { BRIGADA_DEL_JEFE_DEMO, BRIGADAS, COMUNIDADES } from '../src/semilla';
import { Cliente, crearAppPruebas, pdfDePrueba, subirCarta, TOKENS } from './app-pruebas';

/**
 * DoD del Bolt 3 (Release 0.4): panel COED y trámite municipal.
 * 1) El filtro de carta muestra solo los focos que cumplen (con / sin / por validar).
 * 2) La carta es un archivo cifrado, idempotente, con rol; un rechazo con motivo bloquea el despacho.
 * 3) Los 4 estados de brigada se ven en el panel; el jefe reporta "En Liquidación" y el coordinador libera.
 * 4) Con 60 focos activos el panel responde en <1 s.
 * HU-3.1, CU-08, RF-07, RF-08, RNF-05, RNF-07, RNF-08. Requiere PostgreSQL.
 */
describe('Panel COED y trámite municipal (Bolt 3)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let guardaparque: Cliente;
  let coordinador: Cliente;
  let jefeBrigada: Cliente;
  let ugr: Cliente;
  let dirArchivos: string;

  const concepcion = COMUNIDADES[0];
  const cercaDe = (c: { latitud: number; longitud: number }, km = 2) => ({
    latitud: c.latitud + km / 111.195,
    longitud: c.longitud,
    precisionMetros: 8,
  });
  const reportar = async (punto: object = cercaDe(concepcion)): Promise<string> => {
    const id = randomUUID();
    await guardaparque.post('/api/incidentes').send({ id, ...punto }).expect(201);
    return id;
  };
  const verificar = (id: string, resultado: string, motivo?: string) =>
    coordinador.post(`/api/incidentes/${id}/carta-municipal/verificacion`).send({ resultado, motivo });
  const panel = async (query = '') => (await coordinador.get(`/api/panel${query}`).expect(200)).body;
  const idsDelPanel = (body: { incidentes: Record<string, Array<{ id: string }>> }) =>
    Object.values(body.incidentes).flat().map((t) => t.id);
  const eventos = (incidenteId: string) =>
    ds.query('SELECT tipo, detalle FROM evento_auditoria WHERE incidente_id = $1 ORDER BY creado_en', [incidenteId]);

  beforeAll(async () => {
    dirArchivos = mkdtempSync(join(tmpdir(), 'cartas-'));
    process.env.EVIDENCIAS_DIR = dirArchivos;
    const pruebas = await crearAppPruebas();
    app = pruebas.app;
    ds = pruebas.ds;
    guardaparque = pruebas.como(TOKENS.guardaparque);
    coordinador = pruebas.como(TOKENS.coordinador);
    jefeBrigada = pruebas.como(TOKENS.jefeBrigada);
    ugr = pruebas.como(TOKENS.ugr);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('CU-08 / Ley 602: carta municipal digitalizada', () => {
    let id: string;
    const carta = pdfDePrueba('Concepción, solicitud 001/2026');

    beforeAll(async () => {
      id = await reportar();
    });

    it('solo la UGR y el coordinador adjuntan o ven cartas (RNF-08)', async () => {
      await subirCarta(guardaparque, id, carta).expect(403);
      await subirCarta(jefeBrigada, id, carta).expect(403);
      await jefeBrigada.get('/api/cartas/pendientes').expect(403);
      await ugr.post(`/api/incidentes/${id}/carta-municipal/verificacion`).send({ resultado: 'Validada' }).expect(403);
      await ugr.get(`/api/incidentes/${id}/carta-municipal`).expect(404);
    });

    it('el foco sin carta está en la bandeja de la UGR y en el filtro "sin carta"', async () => {
      const pendientes = (await ugr.get('/api/cartas/pendientes').expect(200)).body;
      expect(pendientes.find((p: { id: string }) => p.id === id)).toMatchObject({ nivelRiesgo: 'Alto', carta: null });
      expect(idsDelPanel(await panel('?carta=sin'))).toContain(id);
      expect(idsDelPanel(await panel('?carta=con'))).not.toContain(id);
    });

    it('valida tipo real, tamaño (≤1 MB) y fecha de emisión', async () => {
      await subirCarta(ugr, id, Buffer.from('no soy un pdf'), 'application/pdf').expect(415);
      await subirCarta(ugr, id, Buffer.from('<html>%PDF-</html>'), 'image/png').expect(415);
      const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(1024 * 1024)]);
      await subirCarta(ugr, id, grande).expect(413);
      await ugr
        .post(`/api/incidentes/${id}/carta-municipal`)
        .set('Content-Type', 'application/pdf')
        .send(carta)
        .expect(400);
      await subirCarta(ugr, id, carta, 'application/pdf', '2099-01-01').expect(400);
      await subirCarta(ugr, id, carta, 'application/pdf', '28/09/2026').expect(400);
      await ugr.post(`/api/incidentes/${id}/carta-municipal`).send({ archivoDigital: 'x.pdf' }).expect(415);
      await subirCarta(ugr, randomUUID(), carta).expect(404);
    });

    it('la UGR adjunta el PDF: queda "por validar" y ya habilita el despacho', async () => {
      const res = await subirCarta(ugr, id, carta).expect(201);
      expect(res.body).toMatchObject({
        estadoTramite: 'Recibida',
        estado: 'por_validar',
        tipoMime: 'application/pdf',
        tieneArchivo: true,
        habilitaDespacho: true,
        motivoRechazo: null,
      });
      expect(idsDelPanel(await panel('?carta=por_validar'))).toContain(id);
      expect(idsDelPanel(await panel('?carta=con'))).toContain(id);
      expect(idsDelPanel(await panel('?carta=sin'))).not.toContain(id);
      const pendientes = (await ugr.get('/api/cartas/pendientes').expect(200)).body;
      expect(pendientes.map((p: { id: string }) => p.id)).not.toContain(id);
    });

    it('el reenvío del mismo archivo es idempotente (200) y otro archivo distinto es rechazado (409)', async () => {
      await subirCarta(ugr, id, carta).expect(200);
      await subirCarta(ugr, id, pdfDePrueba('otra carta')).expect(409);
      expect(await ds.query('SELECT count(*)::int AS n FROM carta_municipal WHERE incidente_id = $1', [id])).toEqual([
        { n: 1 },
      ]);
    });

    it('RNF-08: el archivo está cifrado en disco y se descarga íntegro', async () => {
      const archivos = readdirSync(dirArchivos).filter((f) => f.startsWith(`carta-${id}`));
      expect(archivos).toHaveLength(1);
      const enDisco = readFileSync(join(dirArchivos, archivos[0]));
      expect(enDisco.includes(Buffer.from('%PDF'))).toBe(false);
      expect(enDisco.includes(Buffer.from('Concepci'))).toBe(false);
      const res = await coordinador
        .get(`/api/incidentes/${id}/carta-municipal/archivo`)
        .buffer(true)
        .parse((r, cb) => {
          const partes: Buffer[] = [];
          r.on('data', (d: Buffer) => partes.push(d));
          r.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(Buffer.compare(res.body as Buffer, carta)).toBe(0);
    });

    it('el coordinador la valida; se audita y no se puede validar dos veces', async () => {
      const res = await verificar(id, 'Validada').expect(201);
      expect(res.body).toMatchObject({ estadoTramite: 'Validada', estado: 'validada', habilitaDespacho: true });
      await verificar(id, 'Validada').expect(409);
      expect(idsDelPanel(await panel('?carta=por_validar'))).not.toContain(id);
      expect(idsDelPanel(await panel('?carta=con'))).toContain(id);
      expect((await eventos(id)).map((e: { tipo: string }) => e.tipo)).toEqual(['CartaAdjuntada', 'CartaValidada']);
    });

    it('RNF-07: la auditoría de cartas es append-only', async () => {
      await expect(ds.query(`UPDATE evento_auditoria SET detalle = 'x' WHERE incidente_id = $1`, [id])).rejects.toThrow(
        /append-only|inmutable/i,
      );
      await expect(ds.query('DELETE FROM evento_auditoria WHERE incidente_id = $1', [id])).rejects.toThrow();
      await expect(ds.query('TRUNCATE evento_auditoria')).rejects.toThrow();
    });
  });

  describe('CU-08: rechazo con motivo', () => {
    let id: string;

    beforeAll(async () => {
      id = await reportar();
      await subirCarta(ugr, id, pdfDePrueba('ilegible')).expect(201);
    });

    it('el motivo es obligatorio (≥15 caracteres)', async () => {
      await verificar(id, 'Rechazada').expect(400);
      await verificar(id, 'Rechazada', '  ilegible     ').expect(400);
      await verificar(id, 'Anulada', 'motivo suficientemente largo').expect(400);
    });

    it('la carta rechazada bloquea el despacho y vuelve a la bandeja de la UGR', async () => {
      const motivo = 'Firma ilegible y sin sello del municipio';
      const res = await verificar(id, 'Rechazada', motivo).expect(201);
      expect(res.body).toMatchObject({ estado: 'rechazada', motivoRechazo: motivo, habilitaDespacho: false });
      await verificar(id, 'Validada').expect(409);

      const despacho = await coordinador
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: BRIGADAS[0].id })
        .expect(422);
      expect(despacho.body.message).toMatch(/Ley N\.º 602.*rechazada/);

      expect(idsDelPanel(await panel('?carta=sin'))).toContain(id);
      const tarjeta = (await panel()).incidentes.Nuevo.find((t: { id: string }) => t.id === id);
      expect(tarjeta).toMatchObject({ estadoCarta: 'rechazada', tieneCartaMunicipal: false });
      const pendientes = (await ugr.get('/api/cartas/pendientes').expect(200)).body;
      expect(pendientes.find((p: { id: string }) => p.id === id).carta).toMatchObject({ motivoRechazo: motivo });
    });

    it('la UGR adjunta una carta nueva: reemplaza la rechazada y se habilita el despacho', async () => {
      const res = await subirCarta(ugr, id, pdfDePrueba('corregida')).expect(201);
      expect(res.body).toMatchObject({ estado: 'por_validar', motivoRechazo: null, habilitaDespacho: true });
      expect(readdirSync(dirArchivos).filter((f) => f.startsWith(`carta-${id}`))).toHaveLength(1);
      expect((await eventos(id)).map((e: { tipo: string }) => e.tipo)).toEqual([
        'CartaAdjuntada',
        'CartaRechazada',
        'CartaReemplazada',
      ]);
      await coordinador.post(`/api/incidentes/${id}/asignaciones`).send({ brigadaId: BRIGADAS[0].id }).expect(201);
    });

    it('la evaluación del coordinador muestra el trámite', async () => {
      const res = await coordinador.get(`/api/incidentes/${id}/evaluacion`).expect(200);
      expect(res.body.carta).toMatchObject({ estado: 'por_validar', tieneArchivo: true });
    });
  });

  describe('RF-08: estados tácticos de brigada', () => {
    let id: string;
    let asignacionId: string;
    const estado = (brigadaId: string, cliente: Cliente, nuevo: string) =>
      cliente.post(`/api/brigadas/${brigadaId}/estado`).send({ estado: nuevo });
    const brigadaDelPanel = async () =>
      (await panel()).brigadas.find((b: { id: string }) => b.id === BRIGADA_DEL_JEFE_DEMO);

    beforeAll(async () => {
      id = await reportar(cercaDe(COMUNIDADES[2]));
      await subirCarta(ugr, id).expect(201);
    });

    it('el jefe demo ve su brigada; los demás roles no usan esa ruta', async () => {
      const res = await jefeBrigada.get('/api/brigadas/mia').expect(200);
      expect(res.body).toMatchObject({ id: BRIGADA_DEL_JEFE_DEMO, estadoOperativo: 'Disponible', incidente: null });
      expect(res.body.jefe).toMatchObject({ nombre: 'Jefe de Brigada (demo)' });
      await coordinador.get('/api/brigadas/mia').expect(403);
      await guardaparque.post(`/api/brigadas/${BRIGADA_DEL_JEFE_DEMO}/estado`).send({ estado: 'Disponible' }).expect(403);
      await jefeBrigada.get('/api/brigadas').expect(403);
      expect((await coordinador.get('/api/brigadas').expect(200)).body).toHaveLength(BRIGADAS.length);
    });

    it('recorre los 4 estados: Disponible → En Desplazamiento → En Combate Activo → En Liquidación → Disponible', async () => {
      const vistos: string[] = [(await brigadaDelPanel()).estadoOperativo];

      const despacho = await coordinador
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: BRIGADA_DEL_JEFE_DEMO })
        .expect(201);
      asignacionId = despacho.body.asignacion.id;
      const enCamino = await brigadaDelPanel();
      vistos.push(enCamino.estadoOperativo);
      expect(enCamino.incidente).toMatchObject({ id, estado: 'Asignado' });
      await estado(BRIGADA_DEL_JEFE_DEMO, jefeBrigada, 'En_Liquidacion').expect(409);

      await jefeBrigada.post(`/api/asignaciones/${asignacionId}/llegada`).send(cercaDe(COMUNIDADES[2])).expect(201);
      vistos.push((await brigadaDelPanel()).estadoOperativo);

      await estado(BRIGADA_DEL_JEFE_DEMO, coordinador, 'En_Liquidacion').expect(403);
      await estado(BRIGADAS[0].id, jefeBrigada, 'En_Liquidacion').expect(403);
      await estado(BRIGADA_DEL_JEFE_DEMO, jefeBrigada, 'En_Combate_Activo').expect(400);
      const liquidando = await estado(BRIGADA_DEL_JEFE_DEMO, jefeBrigada, 'En_Liquidacion').expect(200);
      vistos.push(liquidando.body.estadoOperativo);
      expect(liquidando.body.incidente).toMatchObject({ id, estado: 'En_Liquidacion' });

      await estado(BRIGADA_DEL_JEFE_DEMO, jefeBrigada, 'Disponible').expect(403);
      const libre = await estado(BRIGADA_DEL_JEFE_DEMO, coordinador, 'Disponible').expect(200);
      vistos.push(libre.body.estadoOperativo);
      expect(libre.body.incidente).toBeNull();
      await estado(BRIGADA_DEL_JEFE_DEMO, coordinador, 'Disponible').expect(409);

      expect(vistos).toEqual(['Disponible', 'En_Desplazamiento', 'En_Combate_Activo', 'En_Liquidacion', 'Disponible']);
    });

    it('el foco pasa a "En Liquidación" (historial) y queda en esa columna del panel', async () => {
      const historial = (await coordinador.get(`/api/incidentes/${id}/historial`).expect(200)).body;
      expect(historial.map((h: { estadoNuevo: string }) => h.estadoNuevo)).toEqual([
        'Nuevo',
        'Asignado',
        'En_Atencion',
        'En_Liquidacion',
      ]);
      expect(historial[3].justificacion).toMatch(/En Liquidación \/ Por Finalizar/);
      expect((await panel()).incidentes.En_Liquidacion.map((t: { id: string }) => t.id)).toContain(id);
      const tipos = (await eventos(id)).map((e: { tipo: string }) => e.tipo);
      expect(tipos.filter((t: string) => t === 'BrigadaEstadoTactico')).toHaveLength(2);
    });

    it('el panel cuenta las brigadas por cada uno de los 4 estados', async () => {
      const { resumen } = await panel();
      expect(Object.keys(resumen.brigadas).sort()).toEqual(
        ['Disponible', 'En_Combate_Activo', 'En_Desplazamiento', 'En_Liquidacion'].sort(),
      );
      const total = Object.values(resumen.brigadas as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(total).toBe(BRIGADAS.length);
    });
  });

  describe('RF-07: filtros y contadores del panel', () => {
    it('rechaza filtros desconocidos (400)', async () => {
      await coordinador.get('/api/panel?carta=tal-vez').expect(400);
      await coordinador.get('/api/panel?riesgo=Extremo').expect(400);
    });

    it('filtra por riesgo y comunidad; los contadores reflejan lo filtrado', async () => {
      const lejano = await reportar({ latitud: -19.5, longitud: -58.5, precisionMetros: 8 });
      const bajos = await panel('?riesgo=Bajo');
      expect(idsDelPanel(bajos)).toEqual([lejano]);
      expect(bajos.resumen.columnas.Nuevo).toEqual({ total: 1, conCarta: 0 });
      expect(bajos.resumen.visibles).toBe(1);
      expect(bajos.resumen.total).toBeGreaterThan(1);
      const deConcepcion = await panel('?comunidad=concepcion');
      expect(idsDelPanel(deConcepcion).length).toBeGreaterThan(0);
      expect(idsDelPanel(deConcepcion)).not.toContain(lejano);
    });
  });

  it('DoD 4 / RNF-05: con 60 focos activos el panel responde en <1 s', async () => {
    for (let i = 0; i < 60; i++) {
      const c = COMUNIDADES[i % COMUNIDADES.length];
      const id = await reportar(cercaDe(c, 1 + (i % 20)));
      if (i % 3 === 0) await subirCarta(ugr, id).expect(201);
    }
    await panel(); // calentamiento
    const inicio = performance.now();
    const res = await panel();
    const ms = performance.now() - inicio;
    expect(res.resumen.total).toBeGreaterThanOrEqual(60);
    expect(ms).toBeLessThan(1000);
    const inicioFiltrado = performance.now();
    await panel('?carta=sin&riesgo=Alto,Medio');
    expect(performance.now() - inicioFiltrado).toBeLessThan(1000);
  });
});
