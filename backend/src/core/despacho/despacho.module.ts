import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperacionesModule } from '../operaciones/operaciones.module';
import { SyncModule } from '../sync/sync.module';
import { Brigada } from './entities/brigada.entity';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { Notificacion } from './entities/notificacion.entity';
import { BrigadasController } from './brigadas.controller';
import { BrigadasService } from './brigadas.service';
import { DespachoController } from './despacho.controller';
import { DespachoService } from './despacho.service';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';

/**
 * core.despacho (M3 / M4): panel, sugerencia y asignación de brigadas; estados tácticos (RF-08);
 * despacho en 1 clic, reasignación táctica y notificación dual Web Push / SMS (Bolt 4).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Brigada, AsignacionDespacho, Notificacion]), OperacionesModule, SyncModule],
  controllers: [DespachoController, BrigadasController, NotificacionesController],
  providers: [DespachoService, BrigadasService, NotificacionesService],
  exports: [TypeOrmModule],
})
export class DespachoModule {}
