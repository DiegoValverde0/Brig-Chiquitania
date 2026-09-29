import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { AlmacenArchivosService, sha256De } from '../../common/almacen-archivos.service';
import { generarPdf } from '../../common/pdf';
import { exigirEnum, exigirObjeto } from '../../common/validacion';
import { AsignacionDespacho } from '../despacho/entities/asignacion-despacho.entity';
import { Brigada } from '../despacho/entities/brigada.entity';
import { Notificacion } from '../despacho/entities/notificacion.entity';
import { EstadoBrigada } from '../despacho/enums/estado-brigada.enum';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { CartaMunicipal } from '../triage/entities/carta-municipal.entity';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { ResultadoCierre } from '../triage/enums/resultado-cierre.enum';
import { AuditoriaService } from './auditoria.service';
import { vistaBitacora } from './bitacora.service';
import { Bitacora } from './entities/bitacora.entity';
import { HistorialEstado } from './entities/historial-estado.entity';
import { InformeConsolidado } from './entities/informe-consolidado.entity';
import { TipoEventoAuditoria } from './enums/tipo-evento-auditoria.enum';
import { aEntradaHistorial, HistorialEstadoService } from './historial-estado.service';
import { DatosInforme, fechaBolivia, lineasInforme } from './informe';
import { LINEA_BASE_MIN, META_AHORRO_PCT } from './operaciones.service';

/** FE-1 (CU-05): mínimo de la justificación de un "Falso positivo" (misma regla que la reclasificación). */
export const JUSTIFICACION_MINIMA_CIERRE = 15;
const JUSTIFICACION_MAXIMA_CIERRE = 500;

/**
 * Decisión 7.2 del PO: "Controlado" y "Extendido" solo después de la llegada; "Falso positivo" desde cualquier
 * estado activo (incluso Nuevo: se descarta sin despachar).
 */
export const ESTADOS_DE_CIERRE: Record<ResultadoCierre, EstadoIncidente[]> = {
  [ResultadoCierre.Controlado]: [EstadoIncidente.En_Atencion, EstadoIncidente.En_Liquidacion],
  [ResultadoCierre.Extendido]: [EstadoIncidente.En_Atencion, EstadoIncidente.En_Liquidacion],
  [ResultadoCierre.Falso_Positivo]: [
    EstadoIncidente.Nuevo,
    EstadoIncidente.Asignado,
    EstadoIncidente.En_Atencion,
    EstadoIncidente.En_Liquidacion,
  ],
};

export interface VistaInforme {
  id: string;
  incidenteId: string;
  resultado: ResultadoCierre;
  fechaGeneracion: Date;
  tiempoTotalDespacho: number | null;
  justificacionFalsoPositivo: string | null;
  sha256: string;
  pesoKB: number;
  /** Descarga del PDF (Coordinador y UGR). */
  url: string;
}

export function vistaInforme(i: InformeConsolidado): VistaInforme {
  return {
    id: i.id,
    incidenteId: i.incidente.id,
    resultado: i.resultado,
    fechaGeneracion: i.fechaGeneracion,
    tiempoTotalDespacho: i.tiempoTotalDespacho,
    justificacionFalsoPositivo: i.justificacionFalsoPositivo,
    sha256: i.sha256,
    pesoKB: i.pesoKB,
    url: `/api/incidentes/${i.incidente.id}/informe/pdf`,
  };
}

/**
 * CU-05 / CU-17 / HU-5.4 / RF-13: cierre del incidente en 1 clic. En una sola transacción: el foco pasa a
 * "Cerrado", se libera la brigada que seguía en él (decisión 7.3) y se genera el informe consolidado en PDF,
 * inmutable (RNF-07). "Falso positivo" exige justificación (FE-1, RS-03: auditoría de falsas alarmas).
 */
@Injectable()
export class CierreService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
    private readonly auditoria: AuditoriaService,
    private readonly almacen: AlmacenArchivosService,
  ) {}

  async cerrar(incidenteId: string, body: unknown, usuario: Usuario): Promise<VistaInforme> {
    const datos = exigirObjeto(body);
    const resultado = exigirEnum(datos.resultado, 'resultado', Object.values(ResultadoCierre));
    const justificacion = typeof datos.justificacion === 'string' ? datos.justificacion.trim() : '';
    if (resultado === ResultadoCierre.Falso_Positivo && justificacion.length < JUSTIFICACION_MINIMA_CIERRE) {
      throw new BadRequestException(
        `Un cierre "Falso positivo" exige justificación de al menos ${JUSTIFICACION_MINIMA_CIERRE} caracteres (tiene ${justificacion.length})`,
      );
    }
    if (justificacion.length > JUSTIFICACION_MAXIMA_CIERRE) {
      throw new BadRequestException(`La justificación no puede superar los ${JUSTIFICACION_MAXIMA_CIERRE} caracteres`);
    }

    let ruta: string | null = null;
    try {
      const informeId = await this.dataSource.transaction(async (em) => {
        const incidente = await em.findOne(Incidente, { where: { id: incidenteId }, lock: { mode: 'pessimistic_write' } });
        if (!incidente) throw new NotFoundException('Incidente no encontrado');
        if (incidente.estado === EstadoIncidente.Cerrado) {
          throw new ConflictException('El incidente ya está cerrado: su informe es inmutable');
        }
        if (!ESTADOS_DE_CIERRE[resultado].includes(incidente.estado)) {
          throw new ConflictException(
            `El foco está "${incidente.estado}": "${resultado}" se cierra después de la llegada (En atención o En Liquidación)`,
          );
        }
        const estadoAnterior = incidente.estado;
        const ahora = new Date();
        await em.update(Incidente, { id: incidenteId }, { estado: EstadoIncidente.Cerrado, resultadoCierre: resultado });
        await this.historial.registrarCambio(
          em,
          incidente,
          estadoAnterior,
          EstadoIncidente.Cerrado,
          `Cierre "${resultado.replace('_', ' ')}" por el coordinador${justificacion ? `: ${justificacion}` : ''}`,
          usuario.id,
        );
        await this.liberarBrigadas(em, incidenteId, usuario.id);

        const compilado = await this.compilar(em, incidenteId, {
          resultado,
          fecha: ahora,
          coordinador: usuario.nombre,
          justificacion: justificacion || null,
        });
        const pdf = generarPdf(
          `Informe FOCO-${incidenteId.slice(0, 8)}`,
          lineasInforme(compilado),
          `Informe Técnico Consolidado · FOCO-${incidenteId.slice(0, 8)} · generado el ${fechaBolivia(ahora)} (hora de Bolivia)`,
          ahora,
        );
        const sha256 = sha256De(pdf);
        ruta = await this.almacen.guardar(`informe-${incidenteId}`, pdf, sha256);
        const informe = em.create(InformeConsolidado, {
          contenidoPDF: ruta,
          sha256,
          pesoKB: Math.round((pdf.length / 1024) * 10) / 10,
          tiempoTotalDespacho: compilado.tiempo ? Math.round(compilado.tiempo.deltaMinutos) : null,
          justificacionFalsoPositivo: resultado === ResultadoCierre.Falso_Positivo ? justificacion : null,
          resultado,
          incidente: { id: incidenteId },
          usuario: { id: usuario.id },
        });
        await em.insert(InformeConsolidado, informe);
        await this.auditoria.registrar(em, {
          tipo: TipoEventoAuditoria.IncidenteCerrado,
          entidad: 'incidente',
          entidadId: incidenteId,
          incidenteId,
          detalle: `Cierre ${resultado}${justificacion ? `: ${justificacion}` : ''} · informe SHA-256 ${sha256}`,
          usuarioId: usuario.id,
        });
        return informe.id;
      });
      return this.ver(incidenteId, informeId);
    } catch (error) {
      if (ruta) await this.almacen.borrar(ruta);
      throw error;
    }
  }

  async ver(incidenteId: string, informeId?: string): Promise<VistaInforme> {
    const informe = await this.dataSource.getRepository(InformeConsolidado).findOne({
      where: informeId ? { id: informeId } : { incidente: { id: incidenteId } },
      relations: { incidente: true },
    });
    if (!informe) throw new NotFoundException('El incidente no tiene informe: todavía no se cerró');
    return vistaInforme(informe);
  }

  async pdf(incidenteId: string): Promise<{ datos: Buffer; nombre: string; sha256: string }> {
    const informe = await this.dataSource
      .getRepository(InformeConsolidado)
      .findOne({ where: { incidente: { id: incidenteId } } });
    if (!informe) throw new NotFoundException('El incidente no tiene informe: todavía no se cerró');
    return {
      datos: await this.almacen.leer(informe.contenidoPDF),
      nombre: `informe-FOCO-${incidenteId.slice(0, 8)}.pdf`,
      sha256: informe.sha256,
    };
  }

  /** Focos cerrados con su informe y el resumen del KPI (insumo de la línea base de campo, Release 1.0). */
  async listar() {
    const informes = await this.dataSource.getRepository(InformeConsolidado).find({
      relations: { incidente: { comunidad: true } },
      order: { fechaGeneracion: 'DESC' },
    });
    const conTiempo = informes.filter((i) => i.tiempoTotalDespacho !== null);
    const cumplen = conTiempo.filter(
      (i) => ((LINEA_BASE_MIN - i.tiempoTotalDespacho!) / LINEA_BASE_MIN) * 100 >= META_AHORRO_PCT,
    );
    return {
      informes: informes.map((i) => ({
        ...vistaInforme(i),
        fechaReporte: i.incidente.fechaReporte,
        comunidad: i.incidente.comunidad?.nombre ?? null,
        nivelRiesgo: i.incidente.nivelRiesgo,
      })),
      resumen: {
        total: informes.length,
        falsosPositivos: informes.filter((i) => i.resultado === ResultadoCierre.Falso_Positivo).length,
        conLlegada: conTiempo.length,
        deltaPromedioMin: conTiempo.length
          ? Math.round((conTiempo.reduce((s, i) => s + i.tiempoTotalDespacho!, 0) / conTiempo.length) * 10) / 10
          : null,
        pctCumpleMeta: conTiempo.length ? Math.round((cumplen.length / conTiempo.length) * 1000) / 10 : null,
        lineaBaseMin: LINEA_BASE_MIN,
        metaAhorroPct: META_AHORRO_PCT,
      },
    };
  }

  /** Decisión 7.3 del PO: la brigada que sigue ligada a este foco (su asignación más reciente) queda Disponible. */
  private async liberarBrigadas(em: EntityManager, incidenteId: string, usuarioId: string): Promise<void> {
    const asignaciones = await em.find(AsignacionDespacho, {
      where: { incidente: { id: incidenteId } },
      relations: { brigada: true },
    });
    const vistas = new Set<string>();
    for (const a of asignaciones) {
      if (vistas.has(a.brigada.id)) continue;
      vistas.add(a.brigada.id);
      const ultima = await em.findOne(AsignacionDespacho, {
        where: { brigada: { id: a.brigada.id } },
        relations: { incidente: true },
        order: { fechaAsignacion: 'DESC' },
      });
      if (ultima?.incidente.id !== incidenteId || a.brigada.estadoOperativo === EstadoBrigada.Disponible) continue;
      await em.update(
        Brigada,
        { id: a.brigada.id },
        { estadoOperativo: EstadoBrigada.Disponible, version: () => 'version + 1' },
      );
      await this.auditoria.registrar(em, {
        tipo: TipoEventoAuditoria.BrigadaEstadoTactico,
        entidad: 'brigada',
        entidadId: a.brigada.id,
        incidenteId,
        detalle: `${a.brigada.nombre}: ${a.brigada.estadoOperativo} → Disponible (cierre de FOCO-${incidenteId.slice(0, 8)})`,
        usuarioId,
      });
    }
  }

  /** Reúne todo el ciclo del incidente para el informe (ya con el estado "Cerrado" y el historial del cierre). */
  private async compilar(em: EntityManager, incidenteId: string, cierre: DatosInforme['cierre']): Promise<DatosInforme> {
    const i = await em.findOneOrFail(Incidente, {
      where: { id: incidenteId },
      relations: { comunidad: { contacto: true } },
    });
    // Secuencial: dentro de una transacción todas las consultas van por la misma conexión.
    const carta = await em.findOneBy(CartaMunicipal, { incidente: { id: incidenteId } });
    const asignaciones = await em.find(AsignacionDespacho, {
      where: { incidente: { id: incidenteId } },
      relations: { brigada: true },
      order: { fechaAsignacion: 'ASC' },
    });
    const notificaciones = await em.find(Notificacion, {
      where: { asignacion: { incidente: { id: incidenteId } } },
      relations: { asignacion: { brigada: true } },
      order: { creadoEn: 'ASC' },
    });
    const bitacoras = await em.find(Bitacora, {
      where: { incidente: { id: incidenteId } },
      relations: { brigada: true, usuario: true },
      order: { fecha: 'ASC' },
    });
    const historial = await em.find(HistorialEstado, {
      where: { incidente: { id: incidenteId } },
      relations: { usuario: true },
      order: { creadoEn: 'ASC' },
    });
    const primeraLlegada = await em.findOne(AsignacionDespacho, {
      where: { incidente: { id: incidenteId }, timestampConfirmacionLlegada: Not(IsNull()) },
      order: { timestampConfirmacionLlegada: 'ASC' },
    });
    let tiempo: DatosInforme['tiempo'] = null;
    if (primeraLlegada?.timestampConfirmacionLlegada) {
      const delta = i.calcularTiempoDespacho(primeraLlegada.timestampConfirmacionLlegada);
      const ahorro = ((LINEA_BASE_MIN - delta) / LINEA_BASE_MIN) * 100;
      tiempo = {
        deltaMinutos: Math.round(delta * 10) / 10,
        ahorroPct: Math.round(ahorro * 10) / 10,
        cumpleMeta: ahorro >= META_AHORRO_PCT,
      };
    }
    const contacto = i.comunidad?.contacto;
    return {
      incidente: {
        id: i.id,
        tipoReporte: i.tipoReporte,
        fechaReporte: i.fechaReporte,
        latitud: i.coordenada.latitud,
        longitud: i.coordenada.longitud,
        precisionMetros: i.coordenada.precisionMetros,
        rumbo: i.rumbo,
        distanciaEstimadaKm: i.distanciaEstimadaKm,
        comunidad: i.comunidad?.nombre ?? null,
        nivelRiesgo: i.nivelRiesgo,
        origenRiesgo: i.origenRiesgo,
        justificacionRiesgo: i.justificacionRiesgo,
        reactivaciones: i.reactivaciones,
      },
      contacto:
        contacto && contacto.validarNoVacio()
          ? { nombre: contacto.nombreAutoridad, telefono: contacto.telefono, cargo: contacto.cargo }
          : null,
      carta: carta ? { estado: carta.estadoTramite, fechaEmision: carta.fechaEmision, motivoRechazo: carta.motivoRechazo } : null,
      asignaciones: asignaciones.map((a) => ({
        brigada: a.brigada.nombre,
        fechaAsignacion: a.fechaAsignacion,
        ruta: a.rutaSugerida,
        llegada: a.timestampConfirmacionLlegada,
      })),
      notificaciones: notificaciones.map((n) => ({
        fecha: n.creadoEn,
        brigada: n.asignacion.brigada.nombre,
        canal: n.canal,
        estado: n.estadoEnvio,
      })),
      tiempo,
      bitacoras: bitacoras.map(vistaBitacora),
      historial: historial.map(aEntradaHistorial),
      cierre,
    };
  }
}
