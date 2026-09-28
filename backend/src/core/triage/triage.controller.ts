import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { TriageService } from './triage.service';

@Controller('incidentes/:id')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /** Registro mínimo de la carta municipal (Ley 602). La subida real del archivo llega en el Bolt 3. */
  @Post('carta-municipal')
  registrarCarta(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<CartaMunicipal> {
    return this.triage.registrarCarta(id, body);
  }
}
