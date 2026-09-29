import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { TriageModule } from '../triage/triage.module';
import { CatalogoService } from './catalogo.service';
import { Comunidad } from './entities/comunidad.entity';
import { ContactoComunal } from './entities/contacto-comunal.entity';
import { EvidenciaFotografica } from './entities/evidencia-fotografica.entity';
import { PredioPrivado } from './entities/predio-privado.entity';
import { EvidenciaService } from './evidencia.service';
import { PrediosService } from './predios.service';
import { ReporteController } from './reporte.controller';
import { ReporteService } from './reporte.service';

/** core.reporte (M1): captura del reporte (GPS / a distancia), fotografía y catálogos (comunidades, predios). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Comunidad, ContactoComunal, EvidenciaFotografica, PredioPrivado]),
    TriageModule,
    OperacionesModule,
  ],
  controllers: [ReporteController],
  providers: [ReporteService, EvidenciaService, CatalogoService, PrediosService],
  exports: [TypeOrmModule, ReporteService],
})
export class ReporteModule {}
