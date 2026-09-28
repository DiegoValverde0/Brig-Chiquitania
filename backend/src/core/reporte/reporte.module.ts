import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { TriageModule } from '../triage/triage.module';
import { Comunidad } from './entities/comunidad.entity';
import { ContactoComunal } from './entities/contacto-comunal.entity';
import { ReporteController } from './reporte.controller';
import { ReporteService } from './reporte.service';

/** core.reporte (M1): captura del reporte y catálogo de comunidades. */
@Module({
  imports: [TypeOrmModule.forFeature([Comunidad, ContactoComunal]), TriageModule, OperacionesModule],
  controllers: [ReporteController],
  providers: [ReporteService],
  exports: [TypeOrmModule],
})
export class ReporteModule {}
