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
} as const;

export type Cliente = {
  get: (url: string) => request.Test;
  post: (url: string) => request.Test;
  put: (url: string) => request.Test;
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
    };
  };
  return { app, ds, como };
}
