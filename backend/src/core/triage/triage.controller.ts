import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { CartaMunicipalService, FocoSinCarta, VistaCarta } from './carta-municipal.service';
import { EvaluacionIncidente, EvaluacionService } from './evaluacion.service';

@Controller()
export class TriageController {
  constructor(
    private readonly cartas: CartaMunicipalService,
    private readonly evaluaciones: EvaluacionService,
  ) {}

  /**
   * CU-08 / Ley 602: adjunta la carta municipal digitalizada (PDF o imagen ≤1 MB, cuerpo binario) con la
   * cabecera `x-fecha-emision`. La emite la UGR; el coordinador la adjunta como contingencia si llega por otro
   * medio. 201 al adjuntar o reemplazar una rechazada; 200 si es el mismo archivo (reintento).
   */
  @Post('incidentes/:id/carta-municipal')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  async adjuntarCarta(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Headers('x-fecha-emision') fechaEmision: string | undefined,
    @UsuarioActual() usuario: Usuario,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VistaCarta> {
    const { carta, duplicada } = await this.cartas.adjuntar(id, req.body, fechaEmision, usuario.id);
    res.status(duplicada ? HttpStatus.OK : HttpStatus.CREATED);
    return carta;
  }

  @Get('incidentes/:id/carta-municipal')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  verCarta(@Param('id', ParseUUIDPipe) id: string): Promise<VistaCarta> {
    return this.cartas.ver(id);
  }

  @Get('incidentes/:id/carta-municipal/archivo')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  async archivoCarta(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { datos, tipoMime } = await this.cartas.leerArchivo(id);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(datos, { type: tipoMime, length: datos.length });
  }

  /** CU-08: `{ "resultado": "Validada" | "Rechazada", "motivo": "…" }` (motivo ≥15 caracteres al rechazar). */
  @Post('incidentes/:id/carta-municipal/verificacion')
  @Roles(Rol.Coordinador)
  verificarCarta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<VistaCarta> {
    return this.cartas.verificar(id, body, usuario.id);
  }

  /** Bandeja de la UGR: focos activos que aún necesitan carta (o cuya carta fue rechazada). */
  @Get('cartas/pendientes')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  pendientes(): Promise<FocoSinCarta[]> {
    return this.cartas.pendientes();
  }

  /** CU-02 (Figura 8): riesgo, justificación del algoritmo, factores evaluados y reclasificaciones. */
  @Get('incidentes/:id/evaluacion')
  @Roles(Rol.Coordinador)
  evaluacion(@Param('id', ParseUUIDPipe) id: string): Promise<EvaluacionIncidente> {
    return this.evaluaciones.evaluacion(id);
  }

  /** Bolt 4: reactiva un foco controlado ("En_Liquidacion" → "Nuevo", Alto) con `{ justificacion }` (≥15). */
  @Post('incidentes/:id/reactivacion')
  @HttpCode(200)
  @Roles(Rol.Coordinador)
  reactivar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<EvaluacionIncidente> {
    return this.evaluaciones.reactivar(id, body, usuario.id);
  }

  /** CU-06 / HU-2.2: reclasificación manual con justificación obligatoria (≥15 caracteres). */
  @Post('incidentes/:id/reclasificacion')
  @Roles(Rol.Coordinador)
  reclasificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<EvaluacionIncidente> {
    return this.evaluaciones.reclasificar(id, body, usuario.id);
  }
}
