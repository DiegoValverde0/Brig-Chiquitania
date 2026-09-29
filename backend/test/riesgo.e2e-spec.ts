import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { BRIGADAS, COMUNIDADES, PREDIOS } from '../src/semilla';
import { Cliente, crearAppPruebas, TOKENS } from './app-pruebas';

/**
 * DoD del Bolt 2 (Release 0.3): motor de riesgo y gobernanza algorítmica.
 * 1) Todo foco Alto justifica "Amenaza directa a vida humana comunitaria".
 * 2) Las estancias privadas quedan excluidas de la priorización automática.
 * 3) Se bloquea toda reclasificación con justificación de menos de 15 caracteres.
 * HU-2.1, HU-2.2, RF-05, RF-06, RS-03. Requiere PostgreSQL.
 */
describe('Motor de riesgo y gobernanza algorítmica (Bolt 2)', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let guardaparque: Cliente;
  let coordinador: Cliente;
  let ugr: Cliente;

  const concepcion = COMUNIDADES[0];
  const estanciaAislada = PREDIOS[0];
  // 1° de latitud ≈ 111,2 km.
  const alNorteDeConcepcion = (km: number) => ({
    latitud: concepcion.latitud + km / 111.195,
    longitud: concepcion.longitud,
    precisionMetros: 8,
  });
  const reportar = async (punto: object) => {
    const id = randomUUID();
    const res = await guardaparque.post('/api/incidentes').send({ id, ...punto }).expect(201);
    return res.body as { id: string; nivelRiesgo: string; justificacionRiesgo: string };
  };
  const reclasificar = (id: string, nivelRiesgo: string, justificacion: string) =>
    coordinador.post(`/api/incidentes/${id}/reclasificacion`).send({ nivelRiesgo, justificacion });

  beforeAll(async () => {
    const pruebas = await crearAppPruebas();
    app = pruebas.app;
    ds = pruebas.ds;
    guardaparque = pruebas.como(TOKENS.guardaparque);
    coordinador = pruebas.como(TOKENS.coordinador);
    ugr = pruebas.como(TOKENS.ugr);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('HU-2.1 / RF-05: motor explicable', () => {
    it('DoD 1: todo foco Alto justifica "Amenaza directa a vida humana comunitaria" y guarda sus factores', async () => {
      for (const km of [0.5, 2, 4.9]) {
        const r = await reportar(alNorteDeConcepcion(km));
        expect(r.nivelRiesgo).toBe('Alto');
        expect(r.justificacionRiesgo).toMatch(/^Amenaza directa a vida humana comunitaria: Concepción a [\d.]+ km/);
      }
      const altos = await ds.query(`SELECT justificacion_riesgo, factores_riesgo FROM incidente WHERE nivel_riesgo = 'Alto'`);
      expect(altos.length).toBeGreaterThanOrEqual(3);
      for (const a of altos) {
        expect(a.justificacion_riesgo).toMatch(/^Amenaza directa a vida humana comunitaria/);
        expect(a.factores_riesgo).toMatchObject({ version: 'motor-v2', regla: 'ComunidadAMenosDe5Km' });
      }
    });

    it('Medio entre 5 y 15 km de una comunidad; Bajo más lejos', async () => {
      expect((await reportar(alNorteDeConcepcion(10))).nivelRiesgo).toBe('Medio');
      expect((await reportar(alNorteDeConcepcion(25))).nivelRiesgo).toBe('Bajo');
    });

    it('DoD 2: un foco junto a una estancia privada y lejos de comunidades NO se prioriza, y lo explica', async () => {
      const r = await reportar({ latitud: estanciaAislada.latitud + 0.003, longitud: estanciaAislada.longitud, precisionMetros: 5 });
      expect(r.nivelRiesgo).toBe('Bajo');
      expect(r.justificacionRiesgo).toMatch(/Excluido de la priorización automática: Estancia El Porvenir \(ejemplo\) a 0\.33 km/);
      const evaluacion = await coordinador.get(`/api/incidentes/${r.id}/evaluacion`).expect(200);
      expect(evaluacion.body.factores.prediosExcluidos).toEqual([
        { nombre: 'El Porvenir (ejemplo)', tipo: 'Estancia', distanciaKm: 0.33 },
      ]);
      // Sin comunidad cercana no hay despacho departamental: la estancia no "compra" prioridad.
      await coordinador.get(`/api/incidentes/${r.id}/brigadas-sugeridas`).expect(422);
    });

    it('la evaluación muestra lo calculado por el motor: nivel, origen, justificación, factores y comunidad', async () => {
      const r = await reportar(alNorteDeConcepcion(2));
      const res = await coordinador.get(`/api/incidentes/${r.id}/evaluacion`).expect(200);
      expect(res.body).toMatchObject({
        id: r.id,
        estado: 'Nuevo',
        nivelRiesgo: 'Alto',
        origenRiesgo: 'Motor',
        comunidad: { id: concepcion.id, nombre: 'Concepción' },
        factores: {
          version: 'motor-v2',
          umbrales: { altoKm: 5, medioKm: 15 },
          comunidadMasCercana: { nombre: 'Concepción', distanciaKm: 2 },
        },
        reclasificaciones: [],
      });
      expect(res.body.justificacionAlgoritmo).toMatch(/^Amenaza directa a vida humana comunitaria/);
      expect(typeof res.body.factores.duracionMs).toBe('number');
    });

    it('el catálogo de predios privados lo mantiene el coordinador', async () => {
      await guardaparque.get('/api/predios-privados').expect(403);
      const lista = await coordinador.get('/api/predios-privados').expect(200);
      expect(lista.body.map((p: { nombre: string }) => p.nombre)).toEqual(expect.arrayContaining(PREDIOS.map((p) => p.nombre)));
      await coordinador.post('/api/predios-privados').send({ nombre: 'Sin ubicación' }).expect(400);
      await coordinador.post('/api/predios-privados').send({ nombre: 'X', tipo: 'Hacienda', latitud: -16, longitud: -61 }).expect(400);
      const nueva = await coordinador
        .post('/api/predios-privados')
        .send({ nombre: 'Santa Rosa', latitud: -17.2, longitud: -61.9 })
        .expect(201);
      expect(nueva.body).toMatchObject({ nombre: 'Santa Rosa', tipo: 'Estancia', latitud: -17.2, longitud: -61.9 });
      // Un foco nuevo junto a esa estancia ya la menciona como excluida.
      const r = await reportar({ latitud: -17.201, longitud: -61.9, precisionMetros: 5 });
      expect(r.justificacionRiesgo).toMatch(/Estancia Santa Rosa a 0\.11 km/);
    });
  });

  describe('HU-2.2 / RF-06: reclasificación manual auditable', () => {
    it('DoD 3: bloquea la reclasificación con justificación de menos de 15 caracteres', async () => {
      const r = await reportar(alNorteDeConcepcion(10)); // Medio
      const corta = await reclasificar(r.id, 'Alto', '14 caracteres.').expect(400);
      expect(corta.body.message).toMatch(/al menos 15 caracteres \(tiene 14\)/);
      await reclasificar(r.id, 'Alto', '   espacios    ').expect(400); // se ignoran los espacios de los extremos
      await coordinador.post(`/api/incidentes/${r.id}/reclasificacion`).send({ nivelRiesgo: 'Alto' }).expect(400);
      await reclasificar(r.id, 'Alto', 'x'.repeat(501)).expect(400);
      await reclasificar(r.id, 'Critico', 'Justificación suficientemente larga').expect(400);
      await reclasificar(r.id, 'Medio', 'Ya es Medio, no hay cambio real').expect(422);
      const [{ nivel_riesgo }] = await ds.query(`SELECT nivel_riesgo FROM incidente WHERE id = $1`, [r.id]);
      expect(nivel_riesgo).toBe('Medio');
    });

    it('solo el coordinador reclasifica', async () => {
      const r = await reportar(alNorteDeConcepcion(10));
      await guardaparque.post(`/api/incidentes/${r.id}/reclasificacion`).send({ nivelRiesgo: 'Alto', justificacion: 'Justificación suficientemente larga' }).expect(403);
      await ugr.post(`/api/incidentes/${r.id}/reclasificacion`).send({ nivelRiesgo: 'Alto', justificacion: 'Justificación suficientemente larga' }).expect(403);
      await reclasificar(randomUUID(), 'Alto', 'Justificación suficientemente larga').expect(404);
    });

    it('con 15 caracteres o más reclasifica y registra quién, cuándo, motivo y niveles, sin perder la explicación del motor', async () => {
      const r = await reportar(alNorteDeConcepcion(10)); // Medio
      const justificacion = 'Viento fuerte hacia la comunidad, humo denso visible';
      const res = await reclasificar(r.id, 'Alto', `  ${justificacion}  `).expect(201);
      expect(res.body).toMatchObject({ nivelRiesgo: 'Alto', origenRiesgo: 'Manual' });
      expect(res.body.justificacionAlgoritmo).toMatch(/^Comunidad habitada en el área de influencia: Concepción/);
      expect(res.body.reclasificaciones).toHaveLength(1);
      expect(res.body.reclasificaciones[0]).toMatchObject({
        tipoEvento: 'Reclasificacion',
        nivelAnterior: 'Medio',
        nivelNuevo: 'Alto',
        estadoAnterior: 'Nuevo',
        estadoNuevo: 'Nuevo',
        justificacion,
        usuario: { rol: 'Coordinador', nombre: 'Coordinador COED (demo)' },
      });
      expect(new Date(res.body.reclasificaciones[0].creadoEn).getTime()).toBeGreaterThan(Date.now() - 60_000);

      // Exactamente 15 caracteres es suficiente.
      await reclasificar(r.id, 'Medio', '123456789012345').expect(201);
      const historial = await coordinador.get(`/api/incidentes/${r.id}/historial`).expect(200);
      expect(historial.body.map((h: { tipoEvento: string }) => h.tipoEvento)).toEqual(['CambioEstado', 'Reclasificacion', 'Reclasificacion']);

      // El panel marca el foco como reclasificado.
      const panel = await coordinador.get('/api/panel').expect(200);
      expect(panel.body.incidentes.Nuevo.find((i: { id: string }) => i.id === r.id)).toMatchObject({ nivelRiesgo: 'Medio', origenRiesgo: 'Manual' });
    });

    it('RNF-07: las reclasificaciones no se pueden editar ni borrar', async () => {
      await expect(ds.query(`UPDATE historial_estado SET justificacion = 'x' WHERE tipo_evento = 'Reclasificacion'`)).rejects.toThrow(/inmutable/);
      await expect(ds.query(`DELETE FROM historial_estado WHERE tipo_evento = 'Reclasificacion'`)).rejects.toThrow(/inmutable/);
    });

    it('RS-03: la decisión humana habilita o bloquea el despacho; nunca lo hace el sistema solo', async () => {
      const r = await reportar(alNorteDeConcepcion(25)); // Bajo
      await coordinador.get(`/api/incidentes/${r.id}/brigadas-sugeridas`).expect(422);
      await reclasificar(r.id, 'Alto', 'Reporte de la UGR: evacuación de familias en curso').expect(201);
      await coordinador.get(`/api/incidentes/${r.id}/brigadas-sugeridas`).expect(200);
      // Sigue haciendo falta la carta municipal (Ley 602) y la confirmación humana del despacho.
      await coordinador.post(`/api/incidentes/${r.id}/asignaciones`).send({ brigadaId: BRIGADAS[0].id }).expect(422);

      const alto = await reportar(alNorteDeConcepcion(1));
      await reclasificar(alto.id, 'Bajo', 'Quema controlada autorizada, verificada con la comunidad').expect(201);
      await coordinador.get(`/api/incidentes/${alto.id}/brigadas-sugeridas`).expect(422);
    });

    it('no se reclasifica un incidente cerrado', async () => {
      const r = await reportar(alNorteDeConcepcion(10));
      await ds.query(`UPDATE incidente SET estado = 'Cerrado' WHERE id = $1`, [r.id]);
      await reclasificar(r.id, 'Alto', 'Justificación suficientemente larga').expect(409);
    });
  });
});
