import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { aplicarSemilla, BRIGADAS, COMUNIDADES, PREDIOS, USUARIOS_DEMO } from './semilla';

/** CLI de la semilla: `npm run build && npm run seed`. */
async function sembrar(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await aplicarSemilla(app.get(DataSource));
    console.log(`Semilla aplicada: ${COMUNIDADES.length} comunidades con contacto, ${BRIGADAS.length} brigadas, ${PREDIOS.length} estancias de ejemplo.`);
    if (process.env.NODE_ENV !== "production") {
      console.log(`Usuarios demo (tokens SOLO de desarrollo): ${USUARIOS_DEMO.map((u) => `${u.rol}=${u.token}`).join(", ")}`);
    }
  } finally {
    await app.close();
  }
}

void sembrar();
