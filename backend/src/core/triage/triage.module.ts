import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incidente } from './entities/incidente.entity';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { MotorRiesgoService } from './motor-riesgo.service';
import { TriageController } from './triage.controller';
import { TriageService } from './triage.service';

/** core.triage (M2): clasificación de riesgo y validación legal del incidente. */
@Module({
  imports: [TypeOrmModule.forFeature([Incidente, CartaMunicipal])],
  controllers: [TriageController],
  providers: [MotorRiesgoService, TriageService],
  exports: [TypeOrmModule, MotorRiesgoService],
})
export class TriageModule {}
