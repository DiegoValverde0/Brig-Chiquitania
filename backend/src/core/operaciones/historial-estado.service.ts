import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { HistorialEstado } from './entities/historial-estado.entity';
import { TipoEventoHistorial } from './enums/tipo-evento-historial.enum';
import { Rol } from '../seguridad/enums/rol.enum';

/** Entrada del historial para la API: quién (sin datos sensibles), cuándo, qué cambió y el motivo. */
export interface EntradaHistorial {
  id: string;
  creadoEn: Date;
  tipoEvento: TipoEventoHistorial;
  estadoAnterior: EstadoIncidente | null;
  estadoNuevo: EstadoIncidente;
  nivelAnterior: NivelRiesgo | null;
  nivelNuevo: NivelRiesgo | null;
  justificacion: string;
  usuario: { id: string; nombre: string; rol: Rol } | null;
}

/** Requiere la relación `usuario` cargada. */
export function aEntradaHistorial(h: HistorialEstado): EntradaHistorial {
  return {
    id: h.id,
    creadoEn: h.creadoEn,
    tipoEvento: h.tipoEvento,
    estadoAnterior: h.estadoAnterior,
    estadoNuevo: h.estadoNuevo,
    nivelAnterior: h.nivelAnterior,
    nivelNuevo: h.nivelNuevo,
    justificacion: h.justificacion,
    usuario: h.usuario ? { id: h.usuario.id, nombre: h.usuario.nombre, rol: h.usuario.rol } : null,
  };
}

/** Única vía de escritura del historial: solo INSERT (RNF-07). Se usa dentro de la transacción del cambio. */
@Injectable()
export class HistorialEstadoService {
  async registrarCambio(
    em: EntityManager,
    incidente: Incidente,
    estadoAnterior: EstadoIncidente | null,
    estadoNuevo: EstadoIncidente,
    justificacion: string,
    usuarioId: string | null = null,
  ): Promise<void> {
    await em.insert(HistorialEstado, {
      incidente: { id: incidente.id },
      tipoEvento: TipoEventoHistorial.CambioEstado,
      estadoAnterior,
      estadoNuevo,
      justificacion,
      usuario: usuarioId ? { id: usuarioId } : null,
    });
  }

  /** Bolt 4: reactivación (En Liquidación → Nuevo, riesgo Alto) con la justificación del coordinador. */
  async registrarReactivacion(
    em: EntityManager,
    incidente: Incidente,
    justificacion: string,
    usuarioId: string,
  ): Promise<void> {
    await em.insert(HistorialEstado, {
      incidente: { id: incidente.id },
      tipoEvento: TipoEventoHistorial.Reactivacion,
      estadoAnterior: incidente.estado,
      estadoNuevo: EstadoIncidente.Nuevo,
      nivelAnterior: incidente.nivelRiesgo,
      nivelNuevo: NivelRiesgo.Alto,
      justificacion,
      usuario: { id: usuarioId },
    });
  }

  /** HU-2.2: reclasificación manual del riesgo; el estado del incidente no cambia. */
  async registrarReclasificacion(
    em: EntityManager,
    incidente: Incidente,
    nivelAnterior: NivelRiesgo | null,
    nivelNuevo: NivelRiesgo,
    justificacion: string,
    usuarioId: string,
  ): Promise<void> {
    await em.insert(HistorialEstado, {
      incidente: { id: incidente.id },
      tipoEvento: TipoEventoHistorial.Reclasificacion,
      estadoAnterior: incidente.estado,
      estadoNuevo: incidente.estado,
      nivelAnterior,
      nivelNuevo,
      justificacion,
      usuario: { id: usuarioId },
    });
  }
}
