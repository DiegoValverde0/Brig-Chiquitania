import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { BrigadaSugerida, DespachoService, OrdenDeSalida } from './despacho.service';

/** COED de la Gobernación: panel y despacho son del coordinador (RS-03: siempre decide un humano). */
@Controller()
@Roles(Rol.Coordinador)
export class DespachoController {
  constructor(private readonly despacho: DespachoService) {}

  @Get('panel')
  panel() {
    return this.despacho.panel();
  }

  @Get('incidentes/:id/brigadas-sugeridas')
  sugerir(@Param('id', ParseUUIDPipe) id: string): Promise<BrigadaSugerida[]> {
    return this.despacho.sugerirBrigadas(id);
  }

  @Post('incidentes/:id/asignaciones')
  asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<OrdenDeSalida> {
    return this.despacho.asignar(id, body, usuario.id);
  }
}
