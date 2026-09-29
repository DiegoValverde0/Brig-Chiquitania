import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BitacoraService, VistaBitacora } from './bitacora.service';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { EntradaHistorial, OperacionesService, TiempoDespacho } from './operaciones.service';

@Controller()
export class OperacionesController {
  constructor(
    private readonly operaciones: OperacionesService,
    private readonly bitacoras: BitacoraService,
  ) {}

  /**
   * HU-5.2 / RF-12: bitácora de turno (checklist) del jefe de la brigada asignada. Idempotente por el `id` del
   * teléfono: 201 nueva, 200 reintento. Solo entre la llegada y el cierre.
   */
  @Post('incidentes/:id/bitacoras')
  @Roles(Rol.JefeBrigada)
  async registrarBitacora(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VistaBitacora> {
    const { bitacora, duplicada } = await this.bitacoras.registrar(id, body, usuario);
    res.status(duplicada ? HttpStatus.OK : HttpStatus.CREATED);
    return bitacora;
  }

  @Get('incidentes/:id/bitacoras')
  @Roles(Rol.Coordinador, Rol.JefeBrigada)
  listarBitacoras(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: Usuario): Promise<VistaBitacora[]> {
    return this.bitacoras.listar(id, usuario);
  }

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
