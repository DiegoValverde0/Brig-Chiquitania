import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { codificarReporte, LARGO_MAXIMO_SMS, uuidACorto } from '../src/core/sync/sms/codec-sms';
import { Rumbo } from '../src/core/reporte/enums/rumbo.enum';
import { BRIGADAS, COMUNIDADES } from '../src/semilla';
import { Cliente, crearAppPruebas, TOKENS } from './app-pruebas';

/**
 * DoD del Bolt 1 (Release 0.2): captura resiliente y contacto comunal.
 * HU-1.1 (foto), HU-1.2 (avistamiento a distancia), HU-1.3 (SMS), HU-1.4 (contacto comunal),
 * RF-02, RF-03, RNF-02, RNF-08 (cifrado y roles) y RS-01/RS-02 (tamaños). Requiere PostgreSQL.
 */
describe('Captura resiliente y contacto comunal (Bolt 1)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let anonimo: Cliente;
  let guardaparque: Cliente;
  let coordinador: Cliente;
  let ugr: Cliente;
  let jefeBrigada: Cliente;
  let dirEvidencias: string;

  const concepcion = COMUNIDADES[0];
  const SECRETO_SMS = 'secreto-sms-solo-desarrollo';
  const reportar = (cuerpo: object) => guardaparque.post('/api/incidentes').send(cuerpo);
  const cercaDeConcepcion = { latitud: -16.1153, longitud: -62.0258, precisionMetros: 8 };

  /** JPEG sintético: cabecera válida + relleno aleatorio del tamaño pedido. */
  const jpeg = (bytes: number): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(bytes - 4)]);

  beforeAll(async () => {
    dirEvidencias = mkdtempSync(join(tmpdir(), 'evidencias-'));
    process.env.EVIDENCIAS_DIR = dirEvidencias;
    const pruebas = await crearAppPruebas();
    app = pruebas.app;
    ds = pruebas.ds;
    anonimo = pruebas.como(null);
    guardaparque = pruebas.como(TOKENS.guardaparque);
    coordinador = pruebas.como(TOKENS.coordinador);
    ugr = pruebas.como(TOKENS.ugr);
    jefeBrigada = pruebas.como(TOKENS.jefeBrigada);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('RNF-08: acceso por rol', () => {
    it('sin token o con token inválido responde 401; /health es público', async () => {
      await anonimo.get('/api/panel').expect(401);
      await anonimo.post('/api/incidentes').send({}).expect(401);
      await anonimo.get('/api/health').expect(200);
      const invalido = (await crearCliente('token-que-no-existe')).get('/api/sesion');
      await invalido.expect(401);
    });

    it('cada rol ve solo lo suyo (el guardaparque no despacha ni ve el panel)', async () => {
      await guardaparque.get('/api/sesion').expect(200, { id: '00000000-0000-4000-8000-000000000401', nombre: 'Guardaparque (demo)', rol: 'Guardaparque' });
      await guardaparque.get('/api/panel').expect(403);
      await guardaparque.post(`/api/incidentes/${randomUUID()}/asignaciones`).send({}).expect(403);
      await guardaparque.post(`/api/incidentes/${randomUUID()}/carta-municipal`).send({}).expect(403);
      await jefeBrigada.get('/api/panel').expect(403);
      await ugr.get('/api/sms/mensajes').expect(403);
      await coordinador.get('/api/panel').expect(200);
    });

    it('el coordinador da de alta usuarios; el token se entrega una sola vez y la BD solo guarda su hash', async () => {
      await guardaparque.post('/api/usuarios').send({ nombre: 'X', rol: 'Coordinador' }).expect(403);
      await coordinador.post('/api/usuarios').send({ nombre: 'Sin rol', rol: 'Jefe' }).expect(400);
      const alta = await coordinador
        .post('/api/usuarios')
        .send({ nombre: 'Comunario de San Rafael', rol: 'Guardaparque', telefono: '+591 70011122' })
        .expect(201);
      expect(alta.body.token).toHaveLength(32);
      const nuevo = await crearCliente(alta.body.token);
      await nuevo.get('/api/sesion').expect(200).expect((r) => expect(r.body.rol).toBe('Guardaparque'));
      const [fila] = await ds.query(`SELECT token_hash, telefono FROM usuario WHERE id = $1`, [alta.body.id]);
      expect(fila.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(fila.token_hash).not.toContain(alta.body.token);
      expect(fila.telefono).toMatch(/^v1:/);
    });
  });

  describe('HU-1.2: avistamiento a distancia', () => {
    const id = randomUUID();

    it('ubica el foco por comunidad + rumbo + distancia y calcula el riesgo', async () => {
      const res = await reportar({ id, tipoReporte: 'Distancia', comunidadId: concepcion.id, rumbo: 'N', distanciaKm: 3 }).expect(201);
      expect(res.body).toMatchObject({
        tipoReporte: 'Distancia',
        estado: 'Nuevo',
        nivelRiesgo: 'Alto',
        rumbo: 'N',
        distanciaEstimadaKm: 3,
        comunidad: { id: concepcion.id, nombre: 'Concepción' },
      });
      // 3 km al norte ≈ +0.027° de latitud, misma longitud; ubicación aproximada (sin precisión GPS).
      expect(res.body.coordenada.latitud).toBeCloseTo(concepcion.latitud + 0.02698, 3);
      expect(res.body.coordenada.longitud).toBeCloseTo(concepcion.longitud, 5);
      expect(res.body.coordenada.precisionMetros).toBeNull();
      // HU-1.4: el contacto comunal llega autocompletado.
      expect(res.body.contactoComunal).toMatchObject({ cargo: expect.any(String), telefono: expect.stringMatching(/^\+591/) });
    });

    it('es idempotente y valida rumbo, distancia y comunidad', async () => {
      await reportar({ id, tipoReporte: 'Distancia', comunidadId: concepcion.id, rumbo: 'N', distanciaKm: 3 }).expect(200);
      const base = { tipoReporte: 'Distancia', comunidadId: concepcion.id, rumbo: 'N', distanciaKm: 3 };
      await reportar({ ...base, id: randomUUID(), rumbo: 'NE' }).expect(400);
      await reportar({ ...base, id: randomUUID(), distanciaKm: 0 }).expect(400);
      await reportar({ ...base, id: randomUUID(), distanciaKm: 80 }).expect(400);
      await reportar({ ...base, id: randomUUID(), comunidadId: randomUUID() }).expect(404);
      await reportar({ ...base, id: randomUUID(), tipoReporte: 'Satelital' }).expect(400);
    });
  });

  describe('HU-1.1 / RF-03: fotografía ≤100 KB, cifrada en disco', () => {
    const id = randomUUID();
    const foto = jpeg(40 * 1024);
    const subir = (cuerpo: Buffer, tipo = 'image/jpeg') =>
      guardaparque
        .post(`/api/incidentes/${id}/evidencia`)
        .set('Content-Type', tipo)
        .set('x-capturada-en', new Date(Date.now() - 60_000).toISOString())
        .send(cuerpo);

    beforeAll(async () => {
      await reportar({ id, ...cercaDeConcepcion }).expect(201);
    });

    it('acepta la foto, la guarda cifrada y el coordinador la recupera intacta', async () => {
      const res = await subir(foto).expect(201);
      expect(res.body).toMatchObject({ pesoKB: 40, tipoMime: 'image/jpeg' });
      const archivos = readdirSync(dirEvidencias).filter((f) => f.startsWith(id));
      expect(archivos).toHaveLength(1);
      const enDisco = readFileSync(join(dirEvidencias, archivos[0]));
      expect(enDisco.includes(foto.subarray(4, 64))).toBe(false); // no está en claro
      const descarga = await coordinador.get(`/api/incidentes/${id}/evidencia`).buffer(true).expect(200);
      expect(descarga.headers['content-type']).toBe('image/jpeg');
      expect(Buffer.compare(descarga.body, foto)).toBe(0);
      await guardaparque.get(`/api/incidentes/${id}/evidencia`).expect(403);
      await guardaparque.get(`/api/incidentes/${id}`).expect(200).expect((r) => expect(r.body.tieneEvidencia).toBe(true));
    });

    it('reenviar la misma foto no es error (reintento offline); otra foto distinta sí (0..1)', async () => {
      await subir(foto).expect(200);
      await subir(jpeg(10 * 1024)).expect(409);
    });

    it('rechaza fotos de más de 100 KB, archivos que no son imagen e incidentes inexistentes', async () => {
      const otro = randomUUID();
      await reportar({ id: otro, ...cercaDeConcepcion }).expect(201);
      const post = (inc: string, cuerpo: Buffer, tipo = 'image/jpeg') =>
        guardaparque.post(`/api/incidentes/${inc}/evidencia`).set('Content-Type', tipo).send(cuerpo);
      await post(otro, jpeg(100 * 1024 + 1)).expect(413);
      await post(otro, Buffer.from('%PDF-1.4 no es una imagen')).expect(415);
      await guardaparque.post(`/api/incidentes/${otro}/evidencia`).send({ foto: 'base64' }).expect(415);
      await post(randomUUID(), jpeg(1024)).expect(404);
      await post(otro, jpeg(100 * 1024)).expect(201); // justo en el límite
    });
  });

  describe('HU-1.3 / RNF-02: canal de contingencia SMS (pasarela simulada)', () => {
    const webhook = (texto: string, de = '+59170000401', secreto = SECRETO_SMS) =>
      anonimo.post('/api/sms/entrante').set('x-sms-secreto', secreto).send({ de, texto });

    it('rechaza el webhook sin el secreto del proveedor', async () => {
      await anonimo.post('/api/sms/entrante').send({ de: '+59170000401', texto: 'BRC1' }).expect(401);
      await webhook('BRC1', '+59170000401', 'otro-secreto').expect(401);
    });

    it('un SMS GPS de ≤160 caracteres crea el reporte y el remitente recibe riesgo y contacto comunal', async () => {
      const id = randomUUID();
      const texto = codificarReporte({ tipo: 'G', id, ...cercaDeConcepcion, fecha: new Date(Date.now() - 5 * 60_000) });
      expect(texto.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
      const res = await webhook(texto).expect(200);
      expect(res.body).toMatchObject({ estado: 'Procesado', duplicado: false, reporte: { id, nivelRiesgo: 'Alto', tipoReporte: 'GPS' } });
      expect(res.body.respuesta).toMatch(new RegExp(`^BRC1 OK ${id.slice(0, 8)} Riesgo Alto \\(Concepcion\\)\\. Contacto: `));
      expect(res.body.respuesta.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
      expect(res.body.respuesta).toMatch(/^[\x20-\x7e]+$/); // un solo segmento GSM-7

      // RNF-01 entre canales: el mismo reporte que luego llega por datos no se duplica.
      await webhook(texto).expect(200).expect((r) => expect(r.body.duplicado).toBe(true));
      await reportar({ id, ...cercaDeConcepcion }).expect(200);
      const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM incidente WHERE id = $1`, [id]);
      expect(n).toBe(1);

      // El historial reconoce al remitente registrado por su teléfono y el canal SMS.
      const historial = await coordinador.get(`/api/incidentes/${id}/historial`).expect(200);
      expect(historial.body[0].justificacion).toMatch(/recibido por SMS/);
      expect(historial.body[0].usuario).toMatchObject({ rol: 'Guardaparque' });
    });

    it('un SMS de avistamiento a distancia también crea el reporte', async () => {
      const id = randomUUID();
      const texto = codificarReporte({ tipo: 'D', id, comunidadId: concepcion.id, rumbo: Rumbo.E, distanciaKm: 2.5, fecha: new Date() });
      const res = await webhook(texto, '+59171234567').expect(200);
      expect(res.body.reporte).toMatchObject({ id, tipoReporte: 'Distancia', rumbo: 'E', distanciaEstimadaKm: 2.5 });
      const historial = await coordinador.get(`/api/incidentes/${id}/historial`).expect(200);
      expect(historial.body[0].usuario).toBeNull(); // remitente no registrado (p. ej. un comunario)
    });

    it('un SMS mal formado o inválido se rechaza con una respuesta de error al remitente', async () => {
      const malo = await webhook('hola, hay humo cerca').expect(200);
      expect(malo.body).toMatchObject({ estado: 'Rechazado', reporte: null });
      expect(malo.body.respuesta).toMatch(/^BRC1 ERR /);

      const impreciso = codificarReporte({ tipo: 'G', id: randomUUID(), ...cercaDeConcepcion, precisionMetros: 40, fecha: new Date() });
      const res = await webhook(impreciso).expect(200);
      expect(res.body).toMatchObject({ estado: 'Rechazado' });
      expect(res.body.motivo).toMatch(/precisionMetros/);
    });

    it('el simulador de la app recorre el mismo camino y la bandeja registra entrantes y salientes cifrados', async () => {
      const id = randomUUID();
      const texto = codificarReporte({ tipo: 'G', id, ...cercaDeConcepcion, fecha: new Date() });
      const res = await guardaparque.post('/api/sms/simulador').send({ texto }).expect(200);
      expect(res.body).toMatchObject({ estado: 'Procesado', reporte: { id } });

      const bandeja = await coordinador.get('/api/sms/mensajes').expect(200);
      const delReporte = bandeja.body.filter((m: { incidenteId: string }) => m.incidenteId === id);
      expect(delReporte.map((m: { direccion: string }) => m.direccion).sort()).toEqual(['Entrante', 'Saliente']);
      expect(delReporte.every((m: { proveedor: string }) => m.proveedor === 'simulado')).toBe(true);
      const filas = await ds.query(`SELECT numero, texto FROM mensaje_sms WHERE incidente_id = $1`, [id]);
      for (const f of filas) {
        expect(f.numero).toMatch(/^v1:/);
        expect(f.texto).toMatch(/^v1:/);
      }
    });
  });

  describe('HU-1.4 / RF-02: contacto comunal obligatorio y catálogo offline', () => {
    it('el catálogo trae cada comunidad con su referente y una versión para la caché', async () => {
      const res = await guardaparque.get('/api/catalogo/comunidades').expect(200);
      expect(res.body.comunidades).toHaveLength(COMUNIDADES.length);
      expect(res.body.comunidades.every((c: { contacto: unknown }) => c.contacto)).toBe(true);
      expect(typeof res.body.version).toBe('string');
      // RS-02: el catálogo completo cabe en pocos KB para descargarlo por 2G.
      expect(JSON.stringify(res.body).length).toBeLessThan(4 * 1024);
    });

    it('DoD: sin referente comunal el despacho queda bloqueado; al registrarlo se habilita', async () => {
      const comunidad = await coordinador
        .post('/api/comunidades')
        .send({ nombre: 'Comunidad Nueva Esperanza', latitud: -15.9, longitud: -61.2 })
        .expect(201);
      expect(comunidad.body.contacto).toBeNull();
      const antes = (await guardaparque.get('/api/catalogo/comunidades')).body.version;

      const id = randomUUID();
      const reporte = await reportar({ id, latitud: -15.91, longitud: -61.2, precisionMetros: 5 }).expect(201);
      expect(reporte.body).toMatchObject({ nivelRiesgo: 'Alto', contactoComunal: null });
      await ugr.post(`/api/incidentes/${id}/carta-municipal`).send({ archivoDigital: 'cartas/ne.pdf', fechaEmision: '2026-09-29' }).expect(201);
      const brigada = BRIGADAS[0].id;
      const bloqueado = await coordinador.post(`/api/incidentes/${id}/asignaciones`).send({ brigadaId: brigada }).expect(422);
      expect(bloqueado.body.message).toMatch(/contacto comunal/);

      await coordinador
        .put(`/api/comunidades/${comunidad.body.id}/contacto`)
        .send({ nombreAutoridad: 'Corregidor', telefono: '12' , cargo: 'Corregidor' })
        .expect(400);
      await guardaparque
        .put(`/api/comunidades/${comunidad.body.id}/contacto`)
        .send({ nombreAutoridad: 'María Chávez', telefono: '+59171112233', cargo: 'Corregidora' })
        .expect(403);
      await coordinador
        .put(`/api/comunidades/${comunidad.body.id}/contacto`)
        .send({ nombreAutoridad: 'María Chávez', telefono: '+591 711-12233', cargo: 'Corregidora' })
        .expect(200)
        .expect((r) => expect(r.body.contacto).toEqual({ nombreAutoridad: 'María Chávez', telefono: '+59171112233', cargo: 'Corregidora' }));
      expect((await guardaparque.get('/api/catalogo/comunidades')).body.version).not.toBe(antes);

      const orden = await coordinador.post(`/api/incidentes/${id}/asignaciones`).send({ brigadaId: brigada }).expect(201);
      expect(orden.body.contactoComunal).toMatchObject({ nombreAutoridad: 'María Chávez', telefono: '+59171112233' });
    });
  });

  describe('RNF-08: cifrado en reposo', () => {
    it('ubicación del foco y datos del referente comunal no están en claro en la BD', async () => {
      const [incidente] = await ds.query(`SELECT latitud, longitud, precision_metros FROM incidente LIMIT 1`);
      expect(incidente.latitud).toMatch(/^v1:/);
      expect(incidente.longitud).toMatch(/^v1:/);
      const contactos = await ds.query(`SELECT nombre_autoridad, telefono FROM contacto_comunal`);
      for (const c of contactos) {
        expect(c.nombre_autoridad).toMatch(/^v1:/);
        expect(c.telefono).toMatch(/^v1:/);
      }
    });
  });

  describe('RS-02: sobriedad de datos', () => {
    it('un reporte típico de la app pesa menos de 2 KB', () => {
      const cuerpo = { id: randomUUID(), tipoReporte: 'GPS', ...cercaDeConcepcion, fechaReporte: new Date().toISOString() };
      expect(Buffer.byteLength(JSON.stringify(cuerpo))).toBeLessThan(2048);
      const sms = codificarReporte({ tipo: 'D', id: randomUUID(), comunidadId: randomUUID(), rumbo: Rumbo.O, distanciaKm: 49.9, fecha: new Date() });
      expect(sms.length).toBeLessThanOrEqual(LARGO_MAXIMO_SMS);
      expect(uuidACorto(randomUUID())).toHaveLength(22);
    });
  });

  /** Cliente con un token arbitrario (reusa la app levantada). */
  async function crearCliente(token: string): Promise<Cliente> {
    const request = (await import('supertest')).default;
    const servidor = () => request(app.getHttpServer());
    const auth = { Authorization: `Bearer ${token}` };
    return {
      get: (url) => servidor().get(url).set(auth),
      post: (url) => servidor().post(url).set(auth),
      put: (url) => servidor().put(url).set(auth),
    };
  }
});
