import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { HistorialEstado } from './entities/historial-estado.entity';

/** Única vía de escritura del historial: solo INSERT (RNF-07). Se usa dentro de la transacción del cambio. */
@Injectable()
export class HistorialEstadoService {
  async registrarCambio(
    em: EntityManager,
    incidente: Incidente,
    estadoAnterior: EstadoIncidente | null,
    estadoNuevo: EstadoIncidente,
    justificacion: string,
  ): Promise<void> {
    await em.insert(HistorialEstado, {
      incidente: { id: incidente.id },
      estadoAnterior,
      estadoNuevo,
      justificacion,
    });
  }
}
