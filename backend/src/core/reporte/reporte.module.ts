import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coordenada } from './entities/coordenada.entity';
import { ContactoComunal } from './entities/contacto-comunal.entity';

/** core.reporte (M1): captura del reporte ciudadano. */
@Module({
  imports: [TypeOrmModule.forFeature([Coordenada, ContactoComunal])],
  exports: [TypeOrmModule],
})
export class ReporteModule {}
