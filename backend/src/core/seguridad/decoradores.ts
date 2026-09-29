import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Rol } from './enums/rol.enum';
import { Usuario } from './entities/usuario.entity';

export const CLAVE_PUBLICO = 'seguridad:publico';
export const CLAVE_ROLES = 'seguridad:roles';

/** Ruta sin token de usuario (health, webhook del proveedor SMS con su propio secreto). */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/** Roles habilitados para la ruta. Sin este decorador basta con estar autenticado. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/** Usuario autenticado de la petición (lo coloca el guard). */
export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Usuario => ctx.switchToHttp().getRequest().usuario,
);
