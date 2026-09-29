import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { aplicarSemilla } from '../src/semilla';
import { prepararBdPruebas } from './bd-pruebas';

/** Tokens de los usuarios demo de la semilla (solo desarrollo y pruebas). */
export const TOKENS = {
  guardaparque: 'demo-guardaparque',
  coordinador: 'demo-coordinador',
  jefeBrigada: 'demo-jefe-brigada',
  ugr: 'demo-ugr',
  /** Bolt 4: jefes demo de las brigadas 1, 2 y 4 (la 3 es de `jefeBrigada`). */
  jefe1: 'demo-jefe-1',
  jefe2: 'demo-jefe-2',
  jefe4: 'demo-jefe-4',
} as const;

export type Cliente = {
  get: (url: string) => request.Test;
  post: (url: string) => request.Test;
  put: (url: string) => request.Test;
  delete: (url: string) => request.Test;
};

export interface AppPruebas {
  app: NestExpressApplication;
  ds: DataSource;
  /** Cliente HTTP autenticado con el token dado (o sin token si es null). */
  como: (token: string | null) => Cliente;
}

/** Levanta la API igual que en producción (configurarApp) sobre una BD de pruebas recién creada y sembrada. */
export async function crearAppPruebas(): Promise<AppPruebas> {
  await prepararBdPruebas();
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configurarApp(app);
  await app.init();
  const ds = app.get(DataSource);
  await aplicarSemilla(ds);
  const como = (token: string | null): Cliente => {
    const conToken = (t: request.Test): request.Test => (token ? t.set('Authorization', `Bearer ${token}`) : t);
    const servidor = () => request(app.getHttpServer());
    return {
      get: (url) => conToken(servidor().get(url)),
      post: (url) => conToken(servidor().post(url)),
      put: (url) => conToken(servidor().put(url)),
      delete: (url) => conToken(servidor().delete(url)),
    };
  };
  return { app, ds, como };
}

/** PDF mínimo para pruebas; la etiqueta cambia el contenido (y su sha256). */
export function pdfDePrueba(etiqueta = 'carta'): Buffer {
  return Buffer.from(`%PDF-1.4\n% Carta municipal de prueba: ${etiqueta}\n%%EOF\n`);
}

/** CU-08: adjunta la carta municipal como archivo binario con su fecha de emisión. */
export function subirCarta(
  cliente: Cliente,
  incidenteId: string,
  archivo: Buffer = pdfDePrueba(incidenteId),
  tipo = 'application/pdf',
  fechaEmision = '2026-09-28',
): request.Test {
  return cliente
    .post(`/api/incidentes/${incidenteId}/carta-municipal`)
    .set('Content-Type', tipo)
    .set('x-fecha-emision', fechaEmision)
    .send(archivo);
}

/** Espera (sondeo) a que se cumpla una condición asíncrona: la notificación sale después de responder el despacho. */
export async function esperar<T>(leer: () => Promise<T>, cumple: (v: T) => boolean, ms = 5000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await leer();
    if (cumple(v) || Date.now() > fin) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}
