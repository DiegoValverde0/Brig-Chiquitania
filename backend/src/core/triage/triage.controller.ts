import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../seguridad/decoradores';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { Rol } from '../seguridad/enums/rol.enum';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { EvaluacionIncidente, EvaluacionService } from './evaluacion.service';
import { TriageService } from './triage.service';

@Controller('incidentes/:id')
export class TriageController {
  constructor(
    private readonly triage: TriageService,
    private readonly evaluaciones: EvaluacionService,
  ) {}

  /**
   * Registro de la carta municipal (Ley 602): la emite la UGR; el coordinador puede cargarla si llega por otro
   * medio. La subida real del archivo llega en el Bolt 3.
   */
  @Post('carta-municipal')
  @Roles(Rol.ResponsableUGR, Rol.Coordinador)
  registrarCarta(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<CartaMunicipal> {
    return this.triage.registrarCarta(id, body);
  }

  /** CU-02 (Figura 8): riesgo, justificación del algoritmo, factores evaluados y reclasificaciones. */
  @Get('evaluacion')
  @Roles(Rol.Coordinador)
  evaluacion(@Param('id', ParseUUIDPipe) id: string): Promise<EvaluacionIncidente> {
    return this.evaluaciones.evaluacion(id);
  }

  /** CU-06 / HU-2.2: reclasificación manual con justificación obligatoria (≥15 caracteres). */
  @Post('reclasificacion')
  @Roles(Rol.Coordinador)
  reclasificar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @UsuarioActual() usuario: Usuario,
  ): Promise<EvaluacionIncidente> {
    return this.evaluaciones.reclasificar(id, body, usuario.id);
  }
}
