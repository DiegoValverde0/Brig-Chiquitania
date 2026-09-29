import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { Catalogo, CatalogoService, ComunidadCatalogo } from './catalogo.service';
import { EvidenciaService } from './evidencia.service';
import { ReporteService, VistaReporte } from './reporte.service';

/** Cualquier usuario autenticado puede reportar un foco (en la práctica, sobre todo guardaparques/comunarios). */
@Controller()
export class ReporteController {
  constructor(
    private readonly reporte: ReporteService,
    private readonly evidencias: EvidenciaService,
    private readonly catalogo: CatalogoService,
  ) {}

  /** HU-1.1 / HU-1.2. 201 al crear; 200 si el UUID ya existía (reintento idempotente, RNF-01). */
  @Post('incidentes')
  async reportar(
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VistaReporte> {
    const { reporte, duplicado } = await this.reporte.reportar(this.reporte.interpretar(body), usuario.id);
    res.status(duplicado ? HttpStatus.OK : HttpStatus.CREATED);
    return reporte;
  }

  /** Estado actual del reporte (la app lo consulta tras sincronizar). */
  @Get('incidentes/:id')
  async ver(@Param('id', ParseUUIDPipe) id: string): Promise<VistaReporte> {
    const vista = await this.reporte.vista(id);
    if (!vista) throw new NotFoundException('Incidente no encontrado');
    return vista;
  }

  /** HU-1.1: foto ≤100 KB como cuerpo binario; cabecera opcional x-capturada-en (ISO 8601). */
  @Post('incidentes/:id/evidencia')
  async subirEvidencia(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Headers('x-capturada-en') capturadaEn: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { evidencia, duplicada } = await this.evidencias.guardar(id, req.body, capturadaEn);
    res.status(duplicada ? HttpStatus.OK : HttpStatus.CREATED);
    return {
      id: evidencia.id,
      pesoKB: evidencia.pesoKB,
      timestamp: evidencia.timestamp,
      tipoMime: evidencia.tipoMime,
      sha256: evidencia.sha256,
    };
  }

  @Get('incidentes/:id/evidencia')
  @Roles(Rol.Coordinador)
  async verEvidencia(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { datos, tipoMime } = await this.evidencias.leer(id);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(datos, { type: tipoMime, length: datos.length });
  }

  /** HU-1.4: catálogo offline de comunidades con su referente comunal. */
  @Get('catalogo/comunidades')
  verCatalogo(): Promise<Catalogo> {
    return this.catalogo.catalogo();
  }

  @Post('comunidades')
  @Roles(Rol.Coordinador)
  crearComunidad(@Body() body: unknown): Promise<ComunidadCatalogo> {
    return this.catalogo.crearComunidad(body);
  }

  @Put('comunidades/:id/contacto')
  @Roles(Rol.Coordinador)
  fijarContacto(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<ComunidadCatalogo> {
    return this.catalogo.fijarContacto(id, body);
  }
}
