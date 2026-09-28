import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Incidente } from '../triage/entities/incidente.entity';
import { ReporteService } from './reporte.service';

@Controller('incidentes')
export class ReporteController {
  constructor(private readonly reporte: ReporteService) {}

  /** 201 al crear; 200 si el UUID ya existía (reintento idempotente). */
  @Post()
  async reportar(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Incidente> {
    const { incidente, duplicado } = await this.reporte.reportarGps(body);
    res.status(duplicado ? HttpStatus.OK : HttpStatus.CREATED);
    return incidente;
  }
}
