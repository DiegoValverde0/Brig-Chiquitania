import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BrigadaSugerida, DespachoService, OrdenDeSalida } from './despacho.service';

@Controller()
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
  asignar(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<OrdenDeSalida> {
    return this.despacho.asignar(id, body);
  }
}
