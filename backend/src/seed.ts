import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { aplicarSemilla, BRIGADAS, COMUNIDADES } from './semilla';

/** CLI de la semilla: `npm run build && npm run seed`. */
async function sembrar(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    await aplicarSemilla(app.get(DataSource));
    console.log(`Semilla aplicada: ${COMUNIDADES.length} comunidades con contacto, ${BRIGADAS.length} brigadas.`);
  } finally {
    await app.close();
  }
}

void sembrar();
