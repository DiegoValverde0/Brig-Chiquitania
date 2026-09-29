import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { BrigadaSugerida, DespachoService, OrdenDeSalida } from './despacho.service';
import { leerFiltros } from './panel';

/** COED de la Gobernación: panel y despacho son del coordinador (RS-03: siempre decide un humano). */
@Controller()
@Roles(Rol.Coordinador)
export class DespachoController {
  constructor(private readonly despacho: DespachoService) {}

  /** Filtros opcionales: ?carta=con|sin|por_validar, ?riesgo=Alto,Medio, ?comunidad=texto. */
  @Get('panel')
  panel(@Query() query: Record<string, unknown>) {
    return this.despacho.panel(leerFiltros(query));
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
