import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlmacenArchivosService } from '../../common/almacen-archivos.service';
import { Bitacora } from './entities/bitacora.entity';
import { EventoAuditoria } from './entities/evento-auditoria.entity';
import { InformeConsolidado } from './entities/informe-consolidado.entity';
import { HistorialEstado } from './entities/historial-estado.entity';
import { AuditoriaInmutableService } from './auditoria-inmutable.service';
import { AuditoriaService } from './auditoria.service';
import { HistorialEstadoService } from './historial-estado.service';
import { OperacionesController } from './operaciones.controller';
import { OperacionesService } from './operaciones.service';

/**
 * core.operaciones (M4 / M5): registro en terreno, cierre y auditoría (historial del incidente y eventos de
 * trámite y de brigada). Provee también el almacén de archivos cifrados que usan reporte y triage.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Bitacora, InformeConsolidado, HistorialEstado, EventoAuditoria])],
  providers: [
    AuditoriaInmutableService,
    HistorialEstadoService,
    AuditoriaService,
    AlmacenArchivosService,
    OperacionesService,
  ],
  controllers: [OperacionesController],
  exports: [TypeOrmModule, HistorialEstadoService, AuditoriaService, AlmacenArchivosService],
})
export class OperacionesModule {}
