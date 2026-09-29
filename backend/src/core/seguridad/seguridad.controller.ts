import { Body, Controller, Get, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from './decoradores';
import { Usuario } from './entities/usuario.entity';
import { Rol } from './enums/rol.enum';
import { SeguridadService } from './seguridad.service';

@Controller()
export class SeguridadController {
  constructor(private readonly seguridad: SeguridadService) {}

  /** Valida el token del dispositivo y devuelve quién es (la app lo usa al iniciar sesión). */
  @Get('sesion')
  sesion(@UsuarioActual() usuario: Usuario): Pick<Usuario, 'id' | 'nombre' | 'rol'> {
    return { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
  }

  /** Alta de usuarios (guardaparques, jefes de brigada, UGR) por el coordinador; el token se entrega una vez. */
  @Post('usuarios')
  @Roles(Rol.Coordinador)
  async crear(@Body() body: unknown): Promise<{ id: string; nombre: string; rol: Rol; token: string }> {
    const { usuario, token } = await this.seguridad.crearUsuario(body);
    return { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, token };
  }
}
