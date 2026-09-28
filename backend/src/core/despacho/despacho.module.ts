import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { Brigada } from './entities/brigada.entity';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { DespachoController } from './despacho.controller';
import { DespachoService } from './despacho.service';

/** core.despacho (M3 / M4): panel, sugerencia y asignación de brigadas a incidentes. */
@Module({
  imports: [TypeOrmModule.forFeature([Brigada, AsignacionDespacho]), OperacionesModule],
  controllers: [DespachoController],
  providers: [DespachoService],
  exports: [TypeOrmModule],
})
export class DespachoModule {}
