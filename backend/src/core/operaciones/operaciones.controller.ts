import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { EntradaHistorial, OperacionesService, TiempoDespacho } from './operaciones.service';

@Controller()
export class OperacionesController {
  constructor(private readonly operaciones: OperacionesService) {}

  @Post('asignaciones/:id/llegada')
  @Roles(Rol.JefeBrigada, Rol.Coordinador)
  confirmarLlegada(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<TiempoDespacho> {
    return this.operaciones.confirmarLlegada(id, body, usuario.id);
  }

  @Get('incidentes/:id/tiempo-despacho')
  @Roles(Rol.Coordinador)
  tiempoDespacho(@Param('id', ParseUUIDPipe) id: string): Promise<TiempoDespacho> {
    return this.operaciones.tiempoDespacho(id);
  }

  @Get('incidentes/:id/historial')
  @Roles(Rol.Coordinador)
  historial(@Param('id', ParseUUIDPipe) id: string): Promise<EntradaHistorial[]> {
    return this.operaciones.historialDe(id);
  }
}
