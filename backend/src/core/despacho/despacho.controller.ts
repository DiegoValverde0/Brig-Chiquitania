import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  /**
   * RF-10: despacho en 1 clic `{ id?, brigadaId, versionBrigada? }`. 201 al crear; 200 si el `id` ya se usó para
   * este mismo despacho (reintento). 409 si la brigada cambió (bloqueo optimista) o ya no es elegible.
   */
  @Post('incidentes/:id/asignaciones')
  async asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrdenDeSalida> {
    const orden = await this.despacho.asignar(id, body, usuario.id);
    res.status(orden.duplicada ? HttpStatus.OK : HttpStatus.CREATED);
    return orden;
  }
}
