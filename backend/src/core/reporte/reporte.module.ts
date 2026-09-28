import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comunidad } from './entities/comunidad.entity';
import { ContactoComunal } from './entities/contacto-comunal.entity';

/** core.reporte (M1): captura del reporte y catálogo de comunidades. */
@Module({
  imports: [TypeOrmModule.forFeature([Comunidad, ContactoComunal])],
  exports: [TypeOrmModule],
})
export class ReporteModule {}
