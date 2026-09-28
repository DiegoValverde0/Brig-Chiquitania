import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { aplicarSemilla, BRIGADAS } from '../src/semilla';
import { prepararBdPruebas } from './bd-pruebas';

/**
 * DoD del Bolt 0: un foco reportado con GPS recorre Nuevo → riesgo → panel → brigada sugerida →
 * llegada → ΔT, sin tocar la BD a mano, y la auditoría es inmutable. Requiere PostgreSQL (ver README).
 */
describe('Flujo E2E del Walking Skeleton (Bolt 0)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => ReturnType<typeof request>;

  // ~2 km al norte de Concepción (comunidad semilla) ⇒ riesgo Alto.
  const cercaDeConcepcion = { latitud: -16.1153, longitud: -62.0258, precisionMetros: 8 };
  // Lejos de toda comunidad semilla ⇒ riesgo Bajo.
  const lejos = { latitud: -19.5, longitud: -58.5, precisionMetros: 8 };
  const brigadaSanIgnacio = BRIGADAS[2].id;

  beforeAll(async () => {
    await prepararBdPruebas();
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    ds = app.get(DataSource);
    await aplicarSemilla(ds);
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  const reportar = (cuerpo: object) => http().post('/api/incidentes').send(cuerpo);

  describe('flujo feliz', () => {
    const id = randomUUID();
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    let asignacionId: string;

    it('HU-1.1: el reporte GPS crea el incidente "Nuevo" con riesgo Alto justificado (HU-2.1)', async () => {
      const res = await reportar({ id, ...cercaDeConcepcion, fechaReporte: haceUnaHora }).expect(201);
      expect(res.body).toMatchObject({ id, estado: 'Nuevo', tipoReporte: 'GPS', nivelRiesgo: 'Alto' });
      expect(res.body.justificacionRiesgo).toMatch(/^Amenaza directa a vida humana comunitaria/);
      expect(res.body.comunidad.nombre).toBe('Concepción');
    });

    it('RNF-01: reenviar el mismo UUID no duplica el incidente', async () => {
      const res = await reportar({ id, ...cercaDeConcepcion }).expect(200);
      expect(res.body.id).toBe(id);
      expect(await ds.query('SELECT count(*)::int AS n FROM incidente WHERE id = $1', [id])).toEqual([{ n: 1 }]);
    });

    it('HU-3.1: el foco aparece en la columna "Nuevo" del panel, sin carta todavía', async () => {
      const res = await http().get('/api/panel').expect(200);
      const foco = res.body.incidentes.Nuevo.find((i: { id: string }) => i.id === id);
      expect(foco).toMatchObject({ nivelRiesgo: 'Alto', tieneCartaMunicipal: false, tieneContactoComunal: true });
      expect(res.body.brigadas).toHaveLength(BRIGADAS.length);
    });

    it('HU-4.1: sugiere brigadas Disponibles ordenadas por cercanía', async () => {
      const res = await http().get(`/api/incidentes/${id}/brigadas-sugeridas`).expect(200);
      const distancias = res.body.map((b: { distanciaKm: number }) => b.distanciaKm);
      expect(distancias).toEqual([...distancias].sort((a, b) => a - b));
      expect(res.body[0].id).toBe(brigadaSanIgnacio);
    });

    it('Ley 602: sin carta municipal el despacho queda bloqueado', async () => {
      const res = await http()
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: brigadaSanIgnacio })
        .expect(422);
      expect(res.body.message).toMatch(/Ley N\.º 602/);
    });

    it('registra la carta municipal (0..1: una segunda carta es rechazada)', async () => {
      const carta = { archivoDigital: 'cartas/concepcion-001.pdf', fechaEmision: '2026-09-28' };
      await http().post(`/api/incidentes/${id}/carta-municipal`).send(carta).expect(201);
      await http().post(`/api/incidentes/${id}/carta-municipal`).send(carta).expect(409);
    });

    it('RS-03: el coordinador confirma el despacho; foco "Asignado" y brigada "En Desplazamiento"', async () => {
      const res = await http()
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: brigadaSanIgnacio })
        .expect(201);
      asignacionId = res.body.asignacion.id;
      expect(res.body.incidente.estado).toBe('Asignado');
      expect(res.body.brigada.estadoOperativo).toBe('En_Desplazamiento');
      expect(res.body.contactoComunal).toMatchObject({ comunidad: 'Concepción' });
      expect(res.body.contactoComunal.telefono).toBeTruthy();
    });

    it('no permite un segundo despacho del mismo incidente', async () => {
      await http()
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: BRIGADAS[0].id })
        .expect(409);
    });

    it('HU-5.1 + HU-5.3: la llegada pasa el foco a "En atención" y calcula ΔT y el ahorro vs. 180 min', async () => {
      const res = await http()
        .post(`/api/asignaciones/${asignacionId}/llegada`)
        .send({ latitud: -16.1150, longitud: -62.0255, precisionMetros: 10 })
        .expect(201);
      expect(res.body.deltaMinutos).toBeGreaterThanOrEqual(60);
      expect(res.body.deltaMinutos).toBeLessThan(62);
      expect(res.body.ahorroPct).toBeGreaterThan(65);
      expect(res.body.cumpleMeta).toBe(true);

      const tiempo = await http().get(`/api/incidentes/${id}/tiempo-despacho`).expect(200);
      expect(tiempo.body).toEqual(res.body);

      const [estado] = await ds.query(
        `SELECT i.estado, b.estado_operativo FROM incidente i, brigada b WHERE i.id = $1 AND b.id = $2`,
        [id, brigadaSanIgnacio],
      );
      expect(estado).toEqual({ estado: 'En_Atencion', estado_operativo: 'En_Combate_Activo' });
    });

    it('la llegada no se puede confirmar dos veces', async () => {
      await http()
        .post(`/api/asignaciones/${asignacionId}/llegada`)
        .send({ latitud: -16.115, longitud: -62.0255 })
        .expect(409);
    });

    it('RNF-07: el historial registra cada transición, con el ΔT asentado', async () => {
      const res = await http().get(`/api/incidentes/${id}/historial`).expect(200);
      expect(res.body.map((h: { estadoNuevo: string }) => h.estadoNuevo)).toEqual([
        'Nuevo',
        'Asignado',
        'En_Atencion',
      ]);
      expect(res.body[2].justificacion).toMatch(/ΔT = \d+(\.\d)? min/);
    });

    it('RNF-07: la BD rechaza editar o borrar el historial y reescribir los timestamps del KPI', async () => {
      await expect(ds.query(`UPDATE historial_estado SET justificacion = 'x'`)).rejects.toThrow(/inmutable/);
      await expect(ds.query(`DELETE FROM historial_estado`)).rejects.toThrow(/inmutable/);
      await expect(ds.query(`TRUNCATE historial_estado CASCADE`)).rejects.toThrow(/inmutable/);
      await expect(
        ds.query(`UPDATE incidente SET fecha_reporte = now() WHERE id = $1`, [id]),
      ).rejects.toThrow(/inmutable/);
      await expect(
        ds.query(`UPDATE asignacion_despacho SET timestamp_confirmacion_llegada = now() WHERE id = $1`, [
          asignacionId,
        ]),
      ).rejects.toThrow(/inmutable/);
    });
  });

  describe('guardas del despacho', () => {
    it('HU-1.1: rechaza precisión GPS >15 m y coordenadas inválidas', async () => {
      await reportar({ id: randomUUID(), ...cercaDeConcepcion, precisionMetros: 40 }).expect(400);
      await reportar({ id: randomUUID(), latitud: 120, longitud: -62, precisionMetros: 5 }).expect(400);
      await reportar({ ...cercaDeConcepcion }).expect(400);
    });

    it('un foco de riesgo Bajo no recibe sugerencias ni despacho departamental', async () => {
      const id = randomUUID();
      const res = await reportar({ id, ...lejos }).expect(201);
      expect(res.body.nivelRiesgo).toBe('Bajo');
      await http().get(`/api/incidentes/${id}/brigadas-sugeridas`).expect(422);
    });

    it('sin contacto comunal el despacho queda bloqueado aunque haya carta', async () => {
      const comunidadId = randomUUID();
      await ds.query(
        `INSERT INTO comunidad (id, nombre, latitud, longitud) VALUES ($1, 'Comunidad sin contacto', -15.5, -61.5)`,
        [comunidadId],
      );
      const id = randomUUID();
      const res = await reportar({ id, latitud: -15.51, longitud: -61.5, precisionMetros: 5 }).expect(201);
      expect(res.body).toMatchObject({ nivelRiesgo: 'Alto', comunidad: { id: comunidadId } });
      await http()
        .post(`/api/incidentes/${id}/carta-municipal`)
        .send({ archivoDigital: 'cartas/x.pdf', fechaEmision: '2026-09-28' })
        .expect(201);
      const despacho = await http()
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: BRIGADAS[0].id })
        .expect(422);
      expect(despacho.body.message).toMatch(/contacto comunal/);
    });

    it('una brigada que no está Disponible no se puede despachar', async () => {
      const id = randomUUID();
      await reportar({ id, ...cercaDeConcepcion }).expect(201);
      await http()
        .post(`/api/incidentes/${id}/carta-municipal`)
        .send({ archivoDigital: 'cartas/y.pdf', fechaEmision: '2026-09-28' })
        .expect(201);
      await http()
        .post(`/api/incidentes/${id}/asignaciones`)
        .send({ brigadaId: brigadaSanIgnacio })
        .expect(409);
    });
  });

  it('RNF-04: con 60 focos activos cada reporte se evalúa en <5 s', async () => {
    const tiempos: number[] = [];
    for (let i = 0; i < 60; i++) {
      const inicio = performance.now();
      await reportar({
        id: randomUUID(),
        latitud: -16 - i * 0.03,
        longitud: -61 - i * 0.02,
        precisionMetros: 5,
      }).expect(201);
      tiempos.push(performance.now() - inicio);
    }
    expect(Math.max(...tiempos)).toBeLessThan(5000);
    const panel = await http().get('/api/panel').expect(200);
    expect(panel.body.incidentes.Nuevo.length).toBeGreaterThanOrEqual(60);
  });
});
