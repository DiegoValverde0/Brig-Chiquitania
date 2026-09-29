import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { Brigada } from './entities/brigada.entity';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { BrigadasController } from './brigadas.controller';
import { BrigadasService } from './brigadas.service';
import { DespachoController } from './despacho.controller';
import { DespachoService } from './despacho.service';

/** core.despacho (M3 / M4): panel, sugerencia y asignación de brigadas; estados tácticos (RF-08). */
@Module({
  imports: [TypeOrmModule.forFeature([Brigada, AsignacionDespacho]), OperacionesModule],
  controllers: [DespachoController, BrigadasController],
  providers: [DespachoService, BrigadasService],
  exports: [TypeOrmModule],
})
export class DespachoModule {}
