import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { CLAVE_PUBLICO, CLAVE_ROLES } from './decoradores';
import { Usuario } from './entities/usuario.entity';
import { Rol } from './enums/rol.enum';
import { hashToken } from './tokens';

/**
 * Guard global (RNF-08: acceso por rol). Toda ruta exige `Authorization: Bearer <token>` salvo las marcadas
 * con @Publico(); si la ruta declara @Roles(...), el rol del usuario debe estar entre ellos.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destino = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, destino)) return true;

    const peticion = ctx.switchToHttp().getRequest();
    const cabecera: unknown = peticion.headers?.authorization;
    const token = typeof cabecera === 'string' && cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Falta el token de acceso (Authorization: Bearer …)');

    const usuario = await this.dataSource
      .getRepository(Usuario)
      .findOneBy({ tokenHash: hashToken(token), activo: true });
    if (!usuario) throw new UnauthorizedException('Token de acceso inválido o revocado');
    peticion.usuario = usuario;

    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(CLAVE_ROLES, destino);
    if (roles && !roles.includes(usuario.rol)) {
      throw new ForbiddenException(`Acción no permitida para el rol ${usuario.rol}`);
    }
    return true;
  }
}
