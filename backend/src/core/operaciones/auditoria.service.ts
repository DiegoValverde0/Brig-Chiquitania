import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { EventoAuditoria } from './entities/evento-auditoria.entity';
import { TipoEventoAuditoria } from './enums/tipo-evento-auditoria.enum';

/** Única vía de escritura de `evento_auditoria`: solo INSERT, dentro de la transacción de la acción (RNF-07). */
@Injectable()
export class AuditoriaService {
  async registrar(
    em: EntityManager,
    evento: {
      tipo: TipoEventoAuditoria;
      entidad: 'carta_municipal' | 'brigada';
      entidadId: string;
      incidenteId: string | null;
      detalle: string;
      usuarioId: string | null;
    },
  ): Promise<void> {
    await em.insert(EventoAuditoria, {
      tipo: evento.tipo,
      entidad: evento.entidad,
      entidadId: evento.entidadId,
      incidenteId: evento.incidenteId,
      detalle: evento.detalle,
      usuario: evento.usuarioId ? { id: evento.usuarioId } : null,
    });
  }
}
