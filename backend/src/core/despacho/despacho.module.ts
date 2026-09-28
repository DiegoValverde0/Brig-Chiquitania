import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brigada } from './entities/brigada.entity';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';

/** core.despacho (M3 / M4): asignación de brigadas a incidentes. */
@Module({
  imports: [TypeOrmModule.forFeature([Brigada, AsignacionDespacho])],
  exports: [TypeOrmModule],
})
export class DespachoModule {}
