import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReporteModule } from '../reporte/reporte.module';
import { MensajeSms } from './sms/mensaje-sms.entity';
import { crearPasarelaSms, PasarelaSms } from './sms/pasarela-sms';
import { SmsController } from './sms/sms.controller';
import { SmsService } from './sms/sms.service';

/**
 * core.sync (MT-1, transversal): canales para campo sin cobertura de datos.
 * Bolt 1: canal de contingencia SMS (pasarela intercambiable; hoy simulada). La sincronización idempotente de
 * reportes ya la garantiza el UUID del cliente en `POST /api/incidentes`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MensajeSms]), ReporteModule],
  controllers: [SmsController],
  providers: [
    SmsService,
    {
      provide: PasarelaSms,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => crearPasarelaSms(config.get<string>('SMS_PROVEEDOR')),
    },
  ],
  exports: [SmsService],
})
export class SyncModule {}
