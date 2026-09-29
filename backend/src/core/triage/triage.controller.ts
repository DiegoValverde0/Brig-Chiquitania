import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../seguridad/decoradores';
import { Rol } from '../seguridad/enums/rol.enum';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { TriageService } from './triage.service';

@Controller('incidentes/:id')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  /**
   * Registro de la carta municipal (Ley 602): la emite la UGR; el coordinador puede cargarla si llega por otro
   * medio. La subida real del archivo llega en el Bolt 3.
   */
  @Post('carta-municipal')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  registrarCarta(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<CartaMunicipal> {
    return this.triage.registrarCarta(id, body);
  }
}
