import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { ReporteModule } from './core/reporte/reporte.module';
import { TriageModule } from './core/triage/triage.module';
import { DespachoModule } from './core/despacho/despacho.module';
import { OperacionesModule } from './core/operaciones/operaciones.module';
import { SyncModule } from './core/sync/sync.module';
import { SeguridadModule } from './core/seguridad/seguridad.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 5432)),
        username: config.get<string>('DB_USER', 'chiquitania'),
        password: config.get<string>('DB_PASSWORD', 'chiquitania_dev'),
        database: config.get<string>('DB_NAME', 'chiquitania_db'),
        autoLoadEntities: true,
        // Solo para el Walking Skeleton; en producción se usarán migraciones.
        synchronize: config.get<string>('DB_SYNCHRONIZE') === 'true',
        // Pool reducido: VPS / hardware rural con 1 GB de RAM.
        extra: { max: 5 },
      }),
    }),
    ReporteModule,
    TriageModule,
    DespachoModule,
    OperacionesModule,
    SyncModule,
    SeguridadModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
