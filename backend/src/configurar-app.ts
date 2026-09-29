import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FiltroErroresCuerpo } from './common/filtro-errores-cuerpo';
import { PESO_MAXIMO_BYTES, TIPOS_IMAGEN } from './core/reporte/evidencia.service';

/**
 * Configuración HTTP común a `main.ts` y a las pruebas e2e.
 * - JSON acotado a 16 KB: los reportes pesan <2 KB (RS-02); rechazar cuerpos grandes protege el VPS.
 * - Fotos como binario crudo, hasta 100 KB (RF-03), sin base64 (un tercio menos de datos en 2G).
 * - Si `FRONTEND_DIR` apunta a la app web, la API también la sirve (desarrollo y pruebas; en el VPS la sirve nginx).
 */
export function configurarApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '16kb' });
  app.useBodyParser('raw', { type: TIPOS_IMAGEN, limit: PESO_MAXIMO_BYTES });
  app.useGlobalFilters(new FiltroErroresCuerpo(app.getHttpAdapter()));
  app.enableShutdownHooks();

  const frontend = process.env.FRONTEND_DIR;
  if (frontend && existsSync(frontend)) {
    app.useStaticAssets(resolve(frontend), {
      setHeaders: (res, ruta) => {
        // El service worker y el HTML se revalidan siempre para que las actualizaciones lleguen.
        if (ruta.endsWith('sw.js') || ruta.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    });
  }
}
