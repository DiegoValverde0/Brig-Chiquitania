import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { Incidente } from './entities/incidente.entity';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { EvaluacionService } from './evaluacion.service';
import { MotorRiesgoService } from './motor-riesgo.service';
import { TriageController } from './triage.controller';
import { CartaMunicipalService } from './carta-municipal.service';

/** core.triage (M2): motor de riesgo explicable, reclasificación manual y trámite legal (carta municipal, Ley 602). */
@Module({
  imports: [TypeOrmModule.forFeature([Incidente, CartaMunicipal]), OperacionesModule],
  controllers: [TriageController],
  providers: [MotorRiesgoService, CartaMunicipalService, EvaluacionService],
  exports: [TypeOrmModule, MotorRiesgoService],
})
export class TriageModule {}
