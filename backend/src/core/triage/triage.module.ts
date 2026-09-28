import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Incidente } from './entities/incidente.entity';
import { CartaMunicipal } from './entities/carta-municipal.entity';

/** core.triage (M2): clasificación de riesgo y validación legal del incidente. */
@Module({
  imports: [TypeOrmModule.forFeature([Incidente, CartaMunicipal])],
  exports: [TypeOrmModule],
})
export class TriageModule {}
