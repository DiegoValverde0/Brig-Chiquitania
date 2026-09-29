import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { NotificacionesService } from '../src/core/despacho/notificaciones.service';
import { BRIGADAS, COMUNIDADES, USUARIOS_DEMO } from '../src/semilla';
import { Cliente, crearAppPruebas, esperar, subirCarta, TOKENS } from './app-pruebas';
import { PushFalso } from './push-falso';

/**
 * DoD del Bolt 4 (Release 0.5): despacho y reasignación táctica.
 * 1) La brigada asignada recibe Web Push o SMS con la ubicación y el contacto comunal.
 * 2) Una brigada "En Liquidación" a <30 km de un foco crítico se sugiere y se despacha en 1 clic sin duplicar.
 * Además: reactivación de focos (decisión 7.2), jefe con teléfono obligatorio (7.4), bloqueo optimista.
 * HU-4.2, HU-4.3, RF-10, RF-11. Requiere PostgreSQL.
 */
describe('Despacho y reasignación táctica (Bolt 4)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let guardaparque: Cliente;
  let coordinador: Cliente;
  let ugr: Cliente;
  let jefe3: Cliente;
  let jefe1: Cliente;
  let jefe2: Cliente;
  let jefe4: Cliente;
  const push = new PushFalso();

  const [B1, B2, B3, B4] = BRIGADAS.map((b) => b.id);
  const sanJose = COMUNIDADES[5];
  const concepcion = COMUNIDADES[0];
  const sanRafael = COMUNIDADES[3];
  const alNorte = (c: { latitud: number; longitud: number }, km: number) => ({
    latitud: c.latitud + km / 111.195,
    longitud: c.longitud,
    precisionMetros: 8,
  });

  /** Foco Alto (cerca de una comunidad) con carta municipal: listo para despachar. */
  const focoListo = async (punto: object, conCarta = true): Promise<string> => {
    const id = randomUUID();
    await guardaparque.post('/api/incidentes').send({ id, ...punto }).expect(201);
    if (conCarta) await subirCarta(ugr, id).expect(201);
    return id;
  };
  const sugerencias = async (id: string) =>
    (await coordinador.get(`/api/incidentes/${id}/brigadas-sugeridas`).expect(200)).body as Array<{
      id: string;
      version: number;
      reasignacion: boolean;
      distanciaKm: number;
      despachable: boolean;
      focoAnterior: { id: string } | null;
    }>;
  const versionDe = async (brigadaId: string) =>
    ((await coordinador.get('/api/brigadas').expect(200)).body as Array<{ id: string; version: number }>).find(
      (b) => b.id === brigadaId,
    )!.version;
  const despachar = (incidenteId: string, brigadaId: string, extra: object = {}) =>
    coordinador.post(`/api/incidentes/${incidenteId}/asignaciones`).send({ brigadaId, ...extra });
  const notificaciones = (asignacionId: string) =>
    ds.query(
      'SELECT canal, estado_envio AS estado, detalle FROM notificacion WHERE asignacion_id = $1 ORDER BY creado_en',
      [asignacionId],
    ) as Promise<Array<{ canal: string; estado: string; detalle: string | null }>>;
  const smsSalientes = async () =>
    ((await coordinador.get('/api/sms/mensajes').expect(200)).body as Array<{ direccion: string; texto: string; numero: string }>).filter(
      (m) => m.direccion === 'Saliente',
    );
  const tarjeta = async (id: string) => {
    const panel = (await coordinador.get('/api/panel').expect(200)).body;
    return Object.values(panel.incidentes as Record<string, Array<{ id: string }>>)
      .flat()
      .find((t) => t.id === id) as Record<string, unknown>;
  };

  beforeAll(async () => {
    process.env.EVIDENCIAS_DIR = mkdtempSync(join(tmpdir(), 'despacho-'));
    await push.iniciar();
    const pruebas = await crearAppPruebas();
    app = pruebas.app;
    ds = pruebas.ds;
    guardaparque = pruebas.como(TOKENS.guardaparque);
    coordinador = pruebas.como(TOKENS.coordinador);
    ugr = pruebas.como(TOKENS.ugr);
    jefe3 = pruebas.como(TOKENS.jefeBrigada);
    jefe1 = pruebas.como(TOKENS.jefe1);
    jefe2 = pruebas.como(TOKENS.jefe2);
    jefe4 = pruebas.como(TOKENS.jefe4);
  });

  afterAll(async () => {
    await app?.close();
    await push.detener();
  });

  describe('DoD 1 / RF-11: SMS al jefe sin suscripción Web Push', () => {
    let foco: string;
    let asignacion: string;
    const idCliente = randomUUID();

    beforeAll(async () => {
      foco = await focoListo(alNorte(sanJose, 2));
    });

    it('el panel ofrece la brigada sugerida con su versión (1 clic) y la API la despacha', async () => {
      const t = await tarjeta(foco);
      expect(t).toMatchObject({ bloqueoDespacho: null, sugerencia: { id: B4, reasignacion: false, despachable: true } });
      const version = (t.sugerencia as { version: number }).version;
      const res = await despachar(foco, B4, { id: idCliente, versionBrigada: version }).expect(201);
      asignacion = res.body.asignacion.id;
      expect(asignacion).toBe(idCliente);
      expect(res.body).toMatchObject({ reasignacion: false, duplicada: false, incidente: { estado: 'Asignado' } });
      expect(res.body.asignacion.rutaSugerida).toMatch(/^\d+(\.\d)? km al (N|NE|E|SE|S|SO|O|NO) \(-17\.\d{5}, -60\.\d{5}\)$/);
    });

    it('sale un SMS ≤160 con coordenadas, ruta y referente comunal al teléfono del jefe', async () => {
      const lista = await esperar(() => notificaciones(asignacion), (l) => l.length > 0);
      expect(lista).toEqual([{ canal: 'SMS', estado: 'Enviada', detalle: 'Sin suscripción Web Push' }]);
      const sms = (await smsSalientes()).find((m) => m.texto.startsWith(`DESPACHO F-${foco.slice(0, 8)}`))!;
      expect(sms.numero).toBe(USUARIOS_DEMO.find((u) => u.token === 'demo-jefe-4')!.telefono);
      expect(sms.texto.length).toBeLessThanOrEqual(160);
      expect(sms.texto).toMatch(/Alto -17\.\d{5},-60\.\d{5} \d+(\.\d)?km (N|NE|E|SE|S|SO|O|NO)\. Ref: Referente de ejemplo San Jose de Chiquitos \+5917000060{2}/);
      expect(await tarjeta(foco)).toMatchObject({ notificacion: { canal: 'SMS', estado: 'Enviada', leida: false } });
    });

    it('RF-10 sin duplicar: reintentar el mismo clic devuelve la misma orden (200)', async () => {
      const res = await despachar(foco, B4, { id: idCliente, versionBrigada: 0 }).expect(200);
      expect(res.body).toMatchObject({ duplicada: true, asignacion: { id: asignacion } });
      expect(await ds.query('SELECT count(*)::int AS n FROM asignacion_despacho WHERE incidente_id = $1', [foco])).toEqual([{ n: 1 }]);
      const otro = await focoListo(alNorte(sanJose, 3));
      await despachar(otro, B4, { id: idCliente }).expect(409);
      expect((await notificaciones(asignacion)).length).toBe(1);
    });

    it('RNF-07: fecha_asignacion (cronómetro) es inmutable en la BD', async () => {
      await expect(
        ds.query(`UPDATE asignacion_despacho SET fecha_asignacion = now() - interval '1 hour' WHERE id = $1`, [asignacion]),
      ).rejects.toThrow(/fecha_asignacion es inmutable/);
    });

    it('el jefe ve la orden de salida y el acuse de recibo la marca leída (solo su brigada)', async () => {
      const mia = (await jefe4.get('/api/brigadas/mia').expect(200)).body;
      expect(mia.orden).toMatchObject({
        asignacionId: asignacion,
        llegadaConfirmada: false,
        incidente: { id: foco, estado: 'Asignado', nivelRiesgo: 'Alto', comunidad: 'San José de Chiquitos' },
        contacto: { nombre: 'Referente de ejemplo San José de Chiquitos' },
        notificacion: { canal: 'SMS', estado: 'Enviada' },
      });
      expect(mia.orden.rutaSugerida).toMatch(/km al/);
      await jefe3.post(`/api/asignaciones/${asignacion}/leida`).expect(403);
      await coordinador.post(`/api/asignaciones/${asignacion}/leida`).expect(403);
      await jefe4.post(`/api/asignaciones/${asignacion}/leida`).expect(200, { leida: true });
      expect(await tarjeta(foco)).toMatchObject({ notificacion: { leida: true } });
    });
  });

  describe('DoD 1 / RF-11: Web Push primero, SMS de respaldo (decisión 7.1)', () => {
    it('solo el jefe de brigada suscribe su navegador, y solo a un servicio de push válido', async () => {
      const { clavePublica } = (await jefe1.get('/api/notificaciones/clave-publica').expect(200)).body;
      expect(Buffer.from(clavePublica, 'base64url')).toHaveLength(65);
      await guardaparque.post('/api/notificaciones/suscripcion').send(push.suscripcion('g')).expect(403);
      await jefe1
        .post('/api/notificaciones/suscripcion')
        .send({ ...push.suscripcion(), endpoint: 'http://169.254.169.254/latest/meta-data' })
        .expect(400);
      await jefe1.post('/api/notificaciones/suscripcion').send({ endpoint: push.suscripcion().endpoint, keys: { p256dh: 'x', auth: 'y' } }).expect(400);
      await jefe1.post('/api/notificaciones/suscripcion').send(push.suscripcion('jefe1')).expect(200, { suscrito: true });
      await jefe1.post('/api/notificaciones/suscripcion').send(push.suscripcion('jefe1')).expect(200);
      expect(await ds.query('SELECT count(*)::int AS n FROM suscripcion_push')).toEqual([{ n: 1 }]);
      const [{ endpoint }] = await ds.query('SELECT endpoint FROM suscripcion_push');
      expect(endpoint).not.toContain('127.0.0.1'); // cifrado en reposo (RNF-08)
    });

    it('el push llega cifrado (aes128gcm + VAPID) con la orden; sin leer en 3 min sale el SMS', async () => {
      const foco = await focoListo(alNorte(concepcion, 2));
      const res = await despachar(foco, B1, { versionBrigada: await versionDe(B1) }).expect(201);
      const asignacion = res.body.asignacion.id;
      const lista = await esperar(() => notificaciones(asignacion), (l) => l.length > 0);
      expect(lista).toEqual([{ canal: 'WebPush', estado: 'Enviada', detalle: null }]);
      const recibido = push.recibidos.find((r) => r.ruta === '/push/jefe1')!;
      expect(recibido.codificacion).toBe('aes128gcm');
      expect(recibido.autorizacion).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
      const mensaje = JSON.parse(recibido.mensaje);
      expect(mensaje).toMatchObject({ asignacionId: asignacion, url: './?pestana=brigada' });
      expect(mensaje.titulo).toBe(`Despacho: FOCO-${foco.slice(0, 8)} (Alto)`);
      expect(mensaje.cuerpo).toMatch(/km al .*Ref: Referente de ejemplo Concepción/);

      const servicio = app.get(NotificacionesService);
      expect(await servicio.revisarPendientes(new Date(Date.now() + 2 * 60000))).toBe(0);
      expect(await servicio.revisarPendientes(new Date(Date.now() + 4 * 60000))).toBe(1);
      expect(await servicio.revisarPendientes(new Date(Date.now() + 9 * 60000))).toBe(0);
      expect((await notificaciones(asignacion)).map((n) => [n.canal, n.estado])).toEqual([
        ['WebPush', 'Enviada'],
        ['SMS', 'Enviada'],
      ]);
      expect((await notificaciones(asignacion))[1].detalle).toMatch(/push sin leer en 3 min/);
    });

    it('si el servicio de push responde 410 (suscripción vencida) se borra y sale el SMS de inmediato', async () => {
      await jefe2.post('/api/notificaciones/suscripcion').send(push.suscripcion('jefe2')).expect(200);
      push.respuesta = 410;
      const foco = await focoListo(alNorte(concepcion, 3));
      const res = await despachar(foco, B2).expect(201);
      const lista = await esperar(() => notificaciones(res.body.asignacion.id), (l) => l.length >= 2);
      push.respuesta = 201;
      expect(lista.map((n) => [n.canal, n.estado])).toEqual([
        ['WebPush', 'Fallida'],
        ['SMS', 'Enviada'],
      ]);
      expect(lista[0].detalle).toMatch(/HTTP 410/);
      const jefe2Id = USUARIOS_DEMO.find((u) => u.token === 'demo-jefe-2')!.id;
      expect(await ds.query('SELECT count(*)::int AS n FROM suscripcion_push WHERE usuario_id = $1', [jefe2Id])).toEqual([{ n: 0 }]);
      // El panel no la muestra como fallida: el SMS llegó.
      expect(await tarjeta(foco)).toMatchObject({ notificacion: { canal: 'SMS', estado: 'Enviada' } });
    });
  });

  describe('RF-10: bloqueo optimista contra el doble despacho (riesgo del bolt)', () => {
    it('10 despachos simultáneos de la misma brigada a 10 focos: exactamente 1 asignación', async () => {
      const focos: string[] = [];
      for (let i = 0; i < 10; i++) focos.push(await focoListo(alNorte(COMUNIDADES[2], 1 + i * 0.2)));
      const version = await versionDe(B3);
      const respuestas = await Promise.all(focos.map((f) => despachar(f, B3, { id: randomUUID(), versionBrigada: version })));
      const estados = respuestas.map((r) => r.status).sort();
      expect(estados.filter((s) => s === 201)).toHaveLength(1);
      expect(estados.filter((s) => s === 409)).toHaveLength(9);
      expect(await ds.query('SELECT count(*)::int AS n FROM asignacion_despacho WHERE brigada_id = $1', [B3])).toEqual([{ n: 1 }]);
    });

    it('una versión vieja de la brigada (el panel estaba desactualizado) da 409', async () => {
      const foco = await focoListo(alNorte(COMUNIDADES[4], 2));
      const res = await despachar(foco, B3, { versionBrigada: 0 }).expect(409);
      expect(res.body.message).toMatch(/Disponible|cambió/);
    });
  });

  describe('Reactivación de focos (decisión 7.2) y reasignación táctica (HU-4.3)', () => {
    let controlado: string;
    let asignacionB3: string;

    beforeAll(async () => {
      // B3 fue despachada en la prueba de concurrencia: llega, combate y pasa a En Liquidación.
      const [fila] = await ds.query('SELECT id, incidente_id FROM asignacion_despacho WHERE brigada_id = $1', [B3]);
      asignacionB3 = fila.id;
      controlado = fila.incidente_id;
      await jefe3.post(`/api/asignaciones/${asignacionB3}/llegada`).send(alNorte(COMUNIDADES[2], 1)).expect(201);
      await jefe3.post(`/api/brigadas/${B3}/estado`).send({ estado: 'En_Liquidacion' }).expect(200);
    });

    it('un reporte nuevo a menos de 2 km de un foco controlado avisa "posible reactivación" sin cambiar su estado', async () => {
      const id = randomUUID();
      const res = await guardaparque.post('/api/incidentes').send({ id, ...alNorte(COMUNIDADES[2], 2.2) }).expect(201);
      expect(res.body.posibleReactivacion.map((p: { id: string }) => p.id)).toContain(controlado);
      expect(await tarjeta(controlado)).toMatchObject({ estado: 'En_Liquidacion', posibleReactivacion: true });
    });

    it('solo el coordinador reactiva, con justificación ≥15, y solo desde En Liquidación', async () => {
      await guardaparque.post(`/api/incidentes/${controlado}/reactivacion`).send({ justificacion: 'Rebrote con viento fuerte' }).expect(403);
      await coordinador.post(`/api/incidentes/${controlado}/reactivacion`).send({ justificacion: 'Rebrote' }).expect(400);
      const res = await coordinador
        .post(`/api/incidentes/${controlado}/reactivacion`)
        .send({ justificacion: 'Rebrote con viento fuerte hacia la comunidad' })
        .expect(200);
      expect(res.body).toMatchObject({ estado: 'Nuevo', nivelRiesgo: 'Alto', origenRiesgo: 'Manual', reactivaciones: 1 });
      expect(res.body.reactivadoEn).toBeTruthy();
      await coordinador
        .post(`/api/incidentes/${controlado}/reactivacion`)
        .send({ justificacion: 'Rebrote con viento fuerte hacia la comunidad' })
        .expect(409);
      const historial = (await coordinador.get(`/api/incidentes/${controlado}/historial`).expect(200)).body;
      expect(historial.at(-1)).toMatchObject({
        tipoEvento: 'Reactivacion',
        estadoAnterior: 'En_Liquidacion',
        estadoNuevo: 'Nuevo',
        nivelNuevo: 'Alto',
        justificacion: 'Rebrote con viento fuerte hacia la comunidad',
        usuario: { rol: 'Coordinador' },
      });
    });

    it('el foco reactivado encabeza la columna Nuevo y sugiere primero a la brigada que lo liquidaba', async () => {
      const panel = (await coordinador.get('/api/panel').expect(200)).body;
      expect(panel.incidentes.Nuevo[0]).toMatchObject({ id: controlado, reactivado: true });
      const lista = await sugerencias(controlado);
      expect(lista[0]).toMatchObject({ id: B3, reasignacion: true, despachable: true });
      expect(lista[0].distanciaKm).toBeLessThan(1);
      const res = await despachar(controlado, B3, { versionBrigada: lista[0].version }).expect(201);
      expect(res.body.reasignacion).toBe(true);
    });

    it('DoD 2: una brigada En Liquidación a 12 km se sugiere primero y se despacha en 1 clic; a más de 30 km, no', async () => {
      // B4 (despachada al principio) llega a 14 km al norte de San José, combate y pasa a En Liquidación.
      const [fila] = await ds.query('SELECT id, incidente_id FROM asignacion_despacho WHERE brigada_id = $1', [B4]);
      await jefe4.post(`/api/asignaciones/${fila.id}/llegada`).send(alNorte(sanJose, 14)).expect(201);
      await jefe4.post(`/api/brigadas/${B4}/estado`).send({ estado: 'En_Liquidacion' }).expect(200);

      const lejos = await focoListo(alNorte(sanRafael, 2));
      expect((await sugerencias(lejos)).map((s) => s.id)).not.toContain(B4);
      // A 6 km, pero el foco es Medio: la reasignación táctica es solo para focos críticos (Alto).
      const medio = await focoListo(alNorte(sanJose, 8));
      expect((await tarjeta(medio)).nivelRiesgo).toBe('Medio');
      expect((await sugerencias(medio)).map((s) => s.id)).not.toContain(B4);

      const cerca = await focoListo(alNorte(sanJose, 2));
      const lista = await sugerencias(cerca);
      expect(lista[0]).toMatchObject({ id: B4, reasignacion: true, focoAnterior: { id: fila.incidente_id } });
      expect(lista[0].distanciaKm).toBeCloseTo(12, 0);
      expect(await tarjeta(cerca)).toMatchObject({ sugerencia: { id: B4, reasignacion: true } });

      const res = await despachar(cerca, B4, { id: randomUUID(), versionBrigada: lista[0].version }).expect(201);
      expect(res.body).toMatchObject({ reasignacion: true, brigada: { estadoOperativo: 'En_Desplazamiento' } });
      // El foco anterior sigue En Liquidación (decisión 7.5) y queda la traza en ambos historiales y en la auditoría.
      const anterior = (await coordinador.get(`/api/incidentes/${fila.incidente_id}/historial`).expect(200)).body;
      expect(anterior.at(-1)).toMatchObject({ estadoNuevo: 'En_Liquidacion' });
      expect(anterior.at(-1).justificacion).toMatch(/Reasignación táctica: Brigada Departamental 4 parte hacia FOCO-/);
      const nuevo = (await coordinador.get(`/api/incidentes/${cerca}/historial`).expect(200)).body;
      expect(nuevo.at(-1).justificacion).toMatch(/Reasignación táctica .* deja FOCO-/);
      expect(
        await ds.query(`SELECT count(*)::int AS n FROM evento_auditoria WHERE tipo = 'ReasignacionTactica' AND entidad_id = $1`, [B4]),
      ).toEqual([{ n: 1 }]);
      // Un segundo clic con la versión vieja no duplica.
      const otro = await focoListo(alNorte(sanJose, 2.5));
      await despachar(otro, B4, { versionBrigada: lista[0].version }).expect(409);
    });
  });

  describe('Decisión 7.4: sin jefe con teléfono no se despacha', () => {
    let brigadaNueva: string;

    beforeAll(async () => {
      brigadaNueva = randomUUID();
      await ds.query(
        `INSERT INTO brigada (id, nombre, estado_operativo, latitud, longitud) VALUES ($1, 'Brigada sin jefe', 'Disponible', $2, $3)`,
        [brigadaNueva, sanRafael.latitud, sanRafael.longitud],
      );
    });

    it('422 sin jefe; el panel desactiva DESPACHAR con el motivo', async () => {
      const foco = await focoListo(alNorte(sanRafael, 1));
      const res = await despachar(foco, brigadaNueva).expect(422);
      expect(res.body.message).toMatch(/no tiene jefe con teléfono registrado/);
      const lista = await sugerencias(foco);
      expect(lista.find((s) => s.id === brigadaNueva)).toMatchObject({ despachable: false });
    });

    it('el coordinador asigna un jefe; sin teléfono sigue bloqueado, con teléfono se despacha', async () => {
      const guardaparqueId = USUARIOS_DEMO[0].id;
      await coordinador.put(`/api/brigadas/${brigadaNueva}/jefe`).send({ usuarioId: guardaparqueId }).expect(422);
      await coordinador.put(`/api/brigadas/${brigadaNueva}/jefe`).send({ usuarioId: USUARIOS_DEMO[4].id }).expect(409);
      await jefe1.put(`/api/brigadas/${brigadaNueva}/jefe`).send({ usuarioId: USUARIOS_DEMO[4].id }).expect(403);

      const sinTelefono = (await coordinador.post('/api/usuarios').send({ nombre: 'Jefe nuevo', rol: 'JefeBrigada' }).expect(201)).body;
      await coordinador.put(`/api/brigadas/${brigadaNueva}/jefe`).send({ usuarioId: sinTelefono.id }).expect(200);
      const foco = await focoListo(alNorte(sanRafael, 1.5));
      await despachar(foco, brigadaNueva).expect(422);

      const conTelefono = (
        await coordinador.post('/api/usuarios').send({ nombre: 'Jefe con celular', rol: 'JefeBrigada', telefono: '+59171112222' }).expect(201)
      ).body;
      const asignado = (await coordinador.put(`/api/brigadas/${brigadaNueva}/jefe`).send({ usuarioId: conTelefono.id }).expect(200)).body;
      expect(asignado).toMatchObject({ jefe: { nombre: 'Jefe con celular' }, jefeConTelefono: true });
      await despachar(foco, brigadaNueva).expect(201);
    });
  });
});
