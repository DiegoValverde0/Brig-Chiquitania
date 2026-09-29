import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { BrigadasService, VistaBrigada } from './brigadas.service';

/** RF-08: estados tácticos. El jefe ve y reporta su brigada; el coordinador ve todas y las libera. */
@Controller('brigadas')
export class BrigadasController {
  constructor(private readonly brigadas: BrigadasService) {}

  @Get()
  @Roles(Rol.Coordinador)
  listar(): Promise<VistaBrigada[]> {
    return this.brigadas.listar();
  }

  @Get('mia')
  @Roles(Rol.JefeBrigada)
  mia(@UsuarioActual() usuario: Usuario): Promise<VistaBrigada> {
    return this.brigadas.mia(usuario);
  }

  @Post(':id/estado')
  @HttpCode(200)
  @Roles(Rol.JefeBrigada, Rol.Coordinador)
  reportar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<VistaBrigada> {
    return this.brigadas.reportarEstado(id, body, usuario);
  }
}
