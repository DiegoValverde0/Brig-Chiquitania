import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import { distanciaKm, rutaEnLineaRecta } from '../../common/geo';
import { exigirNumero, exigirObjeto, exigirUuid } from '../../common/validacion';
import { AuditoriaService } from '../operaciones/auditoria.service';
import { TipoEventoAuditoria } from '../operaciones/enums/tipo-evento-auditoria.enum';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { ContactoComunal } from '../reporte/entities/contacto-comunal.entity';
import { estadoCartaPanel } from '../triage/carta-municipal.service';
import { CartaMunicipal } from '../triage/entities/carta-municipal.entity';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { BrigadasService, ESTADOS_INCIDENTE_ACTIVOS, tieneJefeConTelefono, VistaBrigada } from './brigadas.service';
import {
  BrigadaParaDespacho,
  Candidata,
  candidatas,
  despachoDeTarjeta,
  elegibilidad,
  RIESGOS_DESPACHABLES,
} from './elegibilidad';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { Brigada } from './entities/brigada.entity';
import { EstadoBrigada } from './enums/estado-brigada.enum';
import { NotificacionesService } from './notificaciones.service';
import { armarColumnas, FiltrosPanel, marcarPosiblesReactivaciones, TarjetaPanel } from './panel';

/** Sugerencia de HU-4.1 / HU-4.3: Disponibles por cercanía y, para focos Alto, brigadas En Liquidación <30 km. */
export type BrigadaSugerida = Candidata;

export interface OrdenDeSalida {
  asignacion: AsignacionDespacho;
  incidente: { id: string; estado: EstadoIncidente; latitud: number; longitud: number };
  brigada: { id: string; nombre: string; estadoOperativo: EstadoBrigada };
  /** Contacto comunal obligatorio de la orden de salida (ACTA-002, acuerdo 5). */
  contactoComunal: { comunidad: string; nombreAutoridad: string; telefono: string; cargo: string };
  /** HU-4.3: la brigada venía de liquidar otro foco (reasignación táctica). */
  reasignacion: boolean;
  /** true si la asignación ya existía (reintento del mismo clic): la API responde 200 en vez de 201. */
  duplicada: boolean;
}

@Injectable()
export class DespachoService {
  private readonly log = new Logger(DespachoService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
    private readonly brigadas: BrigadasService,
    private readonly auditoria: AuditoriaService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  /**
   * HU-3.1 / RF-07 / RF-08 / RNF-05: Kanban del COED. Incidentes activos por columna (filtrables por trámite
   * municipal, riesgo y comunidad), contadores por columna, y brigadas con su estado táctico y foco asignado.
   * Bolt 4: cada tarjeta "Nuevo" trae la brigada sugerida para el despacho en 1 clic (o el motivo del bloqueo),
   * las reactivadas encabezan su columna y las asignadas muestran el estado de la notificación.
   */
  async panel(filtros: FiltrosPanel = { carta: null, riesgos: null, comunidad: null }) {
    const [incidentes, brigadas] = await Promise.all([
      this.dataSource.getRepository(Incidente).find({
        where: { estado: Not(EstadoIncidente.Cerrado) },
        relations: { comunidad: { contacto: true }, cartaMunicipal: true },
      }),
      this.brigadas.listar(),
    ]);
    const paraDespacho = brigadas.map(aBrigadaParaDespacho);
    const brigadaDe = new Map(brigadas.filter((b) => b.incidente).map((b) => [b.incidente!.id, b.nombre]));
    const notificaciones = await this.notificaciones.resumenPorIncidente(
      incidentes.filter((i) => ESTADOS_INCIDENTE_ACTIVOS.includes(i.estado)).map((i) => i.id),
    );
    const tarjetas: TarjetaPanel[] = incidentes.map((i) => {
      const tieneCartaMunicipal = !!i.cartaMunicipal?.habilitaDespacho();
      const tieneContactoComunal = !!i.comunidad?.contacto?.validarNoVacio();
      const despacho =
        i.estado === EstadoIncidente.Nuevo
          ? despachoDeTarjeta({ coordenada: i.coordenada, nivelRiesgo: i.nivelRiesgo, tieneCartaMunicipal, tieneContactoComunal }, paraDespacho)
          : { sugerencia: null, bloqueo: null };
      return {
        id: i.id,
        estado: i.estado,
        nivelRiesgo: i.nivelRiesgo,
        origenRiesgo: i.origenRiesgo,
        justificacionRiesgo: i.justificacionRiesgo,
        fechaReporte: i.fechaReporte,
        coordenada: {
          latitud: i.coordenada.latitud,
          longitud: i.coordenada.longitud,
          precisionMetros: i.coordenada.precisionMetros,
        },
        comunidad: i.comunidad?.nombre ?? null,
        estadoCarta: estadoCartaPanel(i.cartaMunicipal),
        tieneCartaMunicipal,
        tieneContactoComunal,
        brigada: brigadaDe.get(i.id) ?? null,
        reactivado: !!i.reactivadoEn,
        posibleReactivacion: false,
        sugerencia: despacho.sugerencia,
        bloqueoDespacho: despacho.bloqueo,
        notificacion: notificaciones.get(i.id) ?? null,
      };
    });
    marcarPosiblesReactivaciones(tarjetas);
    const { incidentes: columnas, columnas: contadores, total, visibles } = armarColumnas(tarjetas, filtros);
    const porEstado = Object.fromEntries(
      Object.values(EstadoBrigada).map((e) => [e, brigadas.filter((b) => b.estadoOperativo === e).length]),
    );
    return {
      incidentes: columnas,
      brigadas,
      resumen: { total, visibles, filtros, columnas: contadores, brigadas: porEstado },
    };
  }

  /**
   * HU-4.1 / HU-4.3: brigadas candidatas para el foco. Solo sugiere; nunca asigna sola (RS-03).
   * Primero las "En Liquidación" a menos de 30 km de un foco Alto (reasignación táctica), luego las Disponibles
   * por cercanía. Cada una trae su versión (bloqueo optimista) y si se puede despachar (jefe con teléfono).
   */
  async sugerirBrigadas(incidenteId: string): Promise<BrigadaSugerida[]> {
    const incidente = await this.dataSource.getRepository(Incidente).findOneBy({ id: incidenteId });
    if (!incidente) throw new NotFoundException('Incidente no encontrado');
    exigirRiesgoDespachable(incidente);
    const brigadas = (await this.brigadas.listar()).map(aBrigadaParaDespacho);
    return candidatas(incidente, brigadas);
  }

  /**
   * HU-4.1 / HU-4.2 / HU-4.3 / RF-10: despacho confirmado en 1 clic por el coordinador.
   * - Idempotente: el cliente envía el UUID de la asignación; reintentar devuelve la misma orden (200).
   * - Bloqueo optimista: si llega `versionBrigada`, la brigada debe seguir en esa versión (si no, 409).
   * - Guardas: Ley 602 (carta), contacto comunal, riesgo Alto/Medio, jefe con teléfono y brigada elegible
   *   (Disponible, o En Liquidación a <30 km de un foco Alto: reasignación táctica).
   * Todo en una transacción; después se notifica al jefe (push o SMS) sin bloquear la respuesta.
   */
  async asignar(incidenteId: string, body: unknown, usuarioId: string | null = null): Promise<OrdenDeSalida> {
    const datos = exigirObjeto(body);
    const brigadaId = exigirUuid(datos.brigadaId, 'brigadaId');
    const asignacionId = datos.id === undefined ? null : exigirUuid(datos.id, 'id');
    const versionBrigada =
      datos.versionBrigada === undefined ? null : exigirNumero(datos.versionBrigada, 'versionBrigada', 0, 2 ** 31 - 1);
    if (versionBrigada !== null && !Number.isInteger(versionBrigada)) {
      throw new BadRequestException('versionBrigada debe ser un entero');
    }

    const resultado = await this.dataSource.transaction(async (em) => {
      const incidente = await em.findOne(Incidente, {
        where: { id: incidenteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!incidente) throw new NotFoundException('Incidente no encontrado');
      // Reintento del mismo clic (red lenta, doble toque): se devuelve la orden ya creada.
      if (asignacionId) {
        const previa = await em.findOne(AsignacionDespacho, {
          where: { id: asignacionId },
          relations: { incidente: true, brigada: true },
        });
        if (previa) {
          if (previa.incidente.id !== incidenteId || previa.brigada.id !== brigadaId) {
            throw new ConflictException('Ese id de asignación ya se usó para otro despacho');
          }
          return { asignacionId, duplicada: true, reasignacion: false };
        }
      }
      if (incidente.estado !== EstadoIncidente.Nuevo) {
        throw new ConflictException(`El incidente está "${incidente.estado}"; solo se despacha desde "Nuevo"`);
      }
      exigirRiesgoDespachable(incidente);
      await exigirCartaMunicipal(em, incidenteId);
      await exigirContactoComunal(em, incidenteId);

      const brigada = await em.findOne(Brigada, { where: { id: brigadaId }, relations: { jefe: true } });
      if (!brigada) throw new NotFoundException('Brigada no encontrada');
      const tipo = elegibilidad(
        brigada.estadoOperativo,
        incidente.nivelRiesgo,
        distanciaKm(incidente.coordenada, brigada.ubicacionActual),
      );
      if (!tipo) {
        throw new ConflictException(
          brigada.estadoOperativo === EstadoBrigada.En_Liquidacion
            ? 'La brigada está En Liquidación: solo se reasigna a un foco Alto a menos de 30 km'
            : 'La brigada no está Disponible',
        );
      }
      if (!tieneJefeConTelefono(brigada)) {
        throw new UnprocessableEntityException(
          'Despacho bloqueado: la brigada no tiene jefe con teléfono registrado (no habría a quién notificar)',
        );
      }
      // La brigada que deja (reasignación) se busca antes de moverla.
      const anterior =
        tipo === 'reasignacion'
          ? await em.findOne(AsignacionDespacho, {
              where: { brigada: { id: brigadaId }, incidente: { estado: EstadoIncidente.En_Liquidacion } },
              relations: { incidente: true },
              order: { fechaAsignacion: 'DESC' },
            })
          : null;

      // Bloqueo optimista: estado y versión que se leyeron (o que vio el coordinador). Si otro despacho o un cambio
      // de estado la tocó entre medio, el UPDATE no afecta filas: nunca hay doble asignación.
      const tomada = await em.update(
        Brigada,
        { id: brigadaId, estadoOperativo: brigada.estadoOperativo, version: versionBrigada ?? brigada.version },
        { estadoOperativo: EstadoBrigada.En_Desplazamiento, version: () => 'version + 1' },
      );
      if (!tomada.affected) {
        throw new ConflictException('La brigada cambió (otro despacho o cambio de estado): actualice el panel');
      }

      const asignacion = em.create(AsignacionDespacho, {
        ...(asignacionId ? { id: asignacionId } : {}),
        incidente: { id: incidenteId },
        brigada: { id: brigadaId },
        rutaSugerida: rutaEnLineaRecta(brigada.ubicacionActual, incidente.coordenada),
      });
      await em.insert(AsignacionDespacho, asignacion);
      await em.update(Incidente, { id: incidenteId }, { estado: EstadoIncidente.Asignado });
      const foco = (id: string) => `FOCO-${id.slice(0, 8)}`;
      await this.historial.registrarCambio(
        em,
        incidente,
        EstadoIncidente.Nuevo,
        EstadoIncidente.Asignado,
        tipo === 'reasignacion'
          ? `Reasignación táctica confirmada por el coordinador: ${brigada.nombre}` +
              (anterior ? ` deja ${foco(anterior.incidente.id)} (En Liquidación)` : ' (estaba En Liquidación)')
          : `Despacho confirmado por el coordinador: ${brigada.nombre}`,
        usuarioId,
      );
      if (tipo === 'reasignacion') {
        if (anterior) {
          // El foco anterior sigue "En Liquidación" hasta su cierre (Bolt 5; decisión 7.5 del PO).
          await this.historial.registrarCambio(
            em,
            anterior.incidente,
            EstadoIncidente.En_Liquidacion,
            EstadoIncidente.En_Liquidacion,
            `Reasignación táctica: ${brigada.nombre} parte hacia ${foco(incidenteId)}`,
            usuarioId,
          );
        }
        await this.auditoria.registrar(em, {
          tipo: TipoEventoAuditoria.ReasignacionTactica,
          entidad: 'brigada',
          entidadId: brigadaId,
          incidenteId,
          detalle: `${brigada.nombre}: ${anterior ? foco(anterior.incidente.id) : 'En Liquidación'} → ${foco(incidenteId)}`,
          usuarioId,
        });
      }
      return { asignacionId: asignacion.id, duplicada: false, reasignacion: tipo === 'reasignacion' };
    });

    if (!resultado.duplicada) {
      // Después del commit: el despacho no depende de la red del proveedor (la notificación queda registrada).
      void this.notificaciones.notificarDespacho(resultado.asignacionId).catch((e: Error) => {
        this.log.error(`No se pudo notificar la asignación ${resultado.asignacionId}: ${e.message}`);
      });
    }
    return this.orden(resultado.asignacionId, resultado.duplicada, resultado.reasignacion);
  }

  private async orden(asignacionId: string, duplicada: boolean, reasignacion: boolean): Promise<OrdenDeSalida> {
    const a = await this.dataSource.getRepository(AsignacionDespacho).findOneOrFail({
      where: { id: asignacionId },
      relations: { incidente: { comunidad: { contacto: true } }, brigada: true },
    });
    const { incidente, brigada } = a;
    const contacto = incidente.comunidad!.contacto!;
    return {
      asignacion: await this.dataSource.getRepository(AsignacionDespacho).findOneByOrFail({ id: asignacionId }),
      incidente: { id: incidente.id, estado: incidente.estado, ...incidente.coordenada },
      brigada: { id: brigada.id, nombre: brigada.nombre, estadoOperativo: brigada.estadoOperativo },
      contactoComunal: {
        comunidad: incidente.comunidad!.nombre,
        nombreAutoridad: contacto.nombreAutoridad,
        telefono: contacto.telefono,
        cargo: contacto.cargo,
      },
      reasignacion,
      duplicada,
    };
  }
}

function aBrigadaParaDespacho(b: VistaBrigada): BrigadaParaDespacho {
  return {
    id: b.id,
    nombre: b.nombre,
    estadoOperativo: b.estadoOperativo,
    ubicacion: b.ubicacion,
    version: b.version,
    jefeConTelefono: b.jefeConTelefono,
    incidente: b.incidente ? { id: b.incidente.id, comunidad: b.incidente.comunidad } : null,
  };
}

function exigirRiesgoDespachable(incidente: Incidente): void {
  if (!incidente.nivelRiesgo || !RIESGOS_DESPACHABLES.includes(incidente.nivelRiesgo)) {
    throw new UnprocessableEntityException(
      `Riesgo ${incidente.nivelRiesgo ?? 'sin calcular'}: el despacho departamental requiere riesgo Alto o Medio`,
    );
  }
}

async function exigirCartaMunicipal(em: EntityManager, incidenteId: string): Promise<void> {
  const carta = await em.findOneBy(CartaMunicipal, { incidente: { id: incidenteId } });
  if (!carta || !carta.habilitaDespacho()) {
    throw new UnprocessableEntityException(
      carta
        ? 'Despacho bloqueado (Ley N.º 602): la carta municipal fue rechazada; la UGR debe adjuntar una nueva'
        : 'Despacho bloqueado (Ley N.º 602): falta la carta formal de solicitud municipal',
    );
  }
}

async function exigirContactoComunal(em: EntityManager, incidenteId: string): Promise<ContactoComunal> {
  const incidente = await em.findOne(Incidente, {
    where: { id: incidenteId },
    relations: { comunidad: { contacto: true } },
  });
  const contacto = incidente?.comunidad?.contacto;
  if (!contacto || !contacto.validarNoVacio()) {
    throw new UnprocessableEntityException(
      'Despacho bloqueado: falta el contacto comunal (nombre y teléfono del referente)',
    );
  }
  return contacto;
}
