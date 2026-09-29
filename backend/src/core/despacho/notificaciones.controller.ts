import { Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { NotificacionesService } from './notificaciones.service';

@Controller('asignaciones')
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  /** HU-4.2: acuse de recibo del jefe de esa brigada (evita el SMS de respaldo a los 3 min). */
  @Post(':id/leida')
  @HttpCode(200)
  @Roles(Rol.JefeBrigada)
  leida(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: Usuario) {
    return this.notificaciones.marcarLeida(id, usuario);
  }
}
