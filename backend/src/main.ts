import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function bootstrap(): Promise<void> {
  // bodyParser: false ⇒ los límites de JSON y de fotos los fija configurarApp (sin parsers duplicados).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configurarApp(app);
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
