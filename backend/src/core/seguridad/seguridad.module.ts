import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutenticacionGuard } from './autenticacion.guard';
import { Usuario } from './entities/usuario.entity';
import { SeguridadController } from './seguridad.controller';
import { SeguridadService } from './seguridad.service';

/** MT-2 (transversal): usuarios, roles y control de acceso (RNF-08). */
@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  controllers: [SeguridadController],
  providers: [SeguridadService, { provide: APP_GUARD, useClass: AutenticacionGuard }],
  exports: [TypeOrmModule],
})
export class SeguridadModule {}
