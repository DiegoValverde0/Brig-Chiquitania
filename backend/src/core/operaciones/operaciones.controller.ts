import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { HistorialEstado } from './entities/historial-estado.entity';
import { OperacionesService, TiempoDespacho } from './operaciones.service';

@Controller()
export class OperacionesController {
  constructor(private readonly operaciones: OperacionesService) {}

  @Post('asignaciones/:id/llegada')
  confirmarLlegada(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<TiempoDespacho> {
    return this.operaciones.confirmarLlegada(id, body);
  }

  @Get('incidentes/:id/tiempo-despacho')
  tiempoDespacho(@Param('id', ParseUUIDPipe) id: string): Promise<TiempoDespacho> {
    return this.operaciones.tiempoDespacho(id);
  }

  @Get('incidentes/:id/historial')
  historial(@Param('id', ParseUUIDPipe) id: string): Promise<HistorialEstado[]> {
    return this.operaciones.historialDe(id);
  }
}
