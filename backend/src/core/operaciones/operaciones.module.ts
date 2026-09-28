import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bitacora } from './entities/bitacora.entity';
import { InformeConsolidado } from './entities/informe-consolidado.entity';
import { HistorialEstado } from './entities/historial-estado.entity';
import { AuditoriaInmutableService } from './auditoria-inmutable.service';

/** core.operaciones (M4 / M5): registro en terreno, cierre y auditoría del ciclo de vida. */
@Module({
  imports: [TypeOrmModule.forFeature([Bitacora, InformeConsolidado, HistorialEstado])],
  providers: [AuditoriaInmutableService],
  exports: [TypeOrmModule],
})
export class OperacionesModule {}
