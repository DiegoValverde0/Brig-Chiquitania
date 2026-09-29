import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { CierreService, VistaInforme } from './cierre.service';

/** CU-05 / CU-17 / HU-5.4: cierre institucional e informe consolidado. */
@Controller()
export class CierreController {
  constructor(private readonly cierres: CierreService) {}

  /**
   * Cierre en 1 clic `{ resultado: "Controlado" | "Extendido" | "Falso_Positivo", justificacion? }`
   * (obligatoria ≥15 caracteres en Falso positivo). Genera el informe PDF inmutable.
   */
  @Post('incidentes/:id/cierre')
  @Roles(Rol.Coordinador)
  cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<VistaInforme> {
    return this.cierres.cerrar(id, body, usuario);
  }

  /** Decisión 7.6 del PO: el informe lo ven el Coordinador y la UGR municipal (Ley 602). */
  @Get('incidentes/:id/informe')
  @Roles(Rol.Coordinador, Rol.ResponsableUGR)
  informe(@Param('id', ParseUUIDPipe) id: string): Promise<VistaInforme> {
    return this.cierres.ver(id);
  }

  @Get('incidentes/:id/informe/pdf')
  @Roles(Rol.Coordinador, Rol.ResponsableUGR)
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { datos, nombre, sha256 } = await this.cierres.pdf(id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Informe-SHA256', sha256);
    return new StreamableFile(datos, { type: 'application/pdf', length: datos.length, disposition: `attachment; filename="${nombre}"` });
  }

  @Get('informes')
  @Roles(Rol.Coordinador, Rol.ResponsableUGR)
  listar() {
    return this.cierres.listar();
  }
}
