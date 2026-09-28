import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bitacora } from './entities/bitacora.entity';
import { InformeConsolidado } from './entities/informe-consolidado.entity';

/** core.operaciones (M4 / M5): registro en terreno y cierre de operaciones. */
@Module({
  imports: [TypeOrmModule.forFeature([Bitacora, InformeConsolidado])],
  exports: [TypeOrmModule],
})
export class OperacionesModule {}
