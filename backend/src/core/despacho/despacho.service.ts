import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import { distanciaKm } from '../../common/geo';
import { exigirObjeto, exigirUuid } from '../../common/validacion';
import { HistorialEstadoService } from '../operaciones/historial-estado.service';
import { ContactoComunal } from '../reporte/entities/contacto-comunal.entity';
import { estadoCartaPanel } from '../triage/carta-municipal.service';
import { CartaMunicipal } from '../triage/entities/carta-municipal.entity';
import { Incidente } from '../triage/entities/incidente.entity';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { BrigadasService } from './brigadas.service';
import { Brigada } from './entities/brigada.entity';
import { EstadoBrigada } from './enums/estado-brigada.enum';
import { armarColumnas, FiltrosPanel, TarjetaPanel } from './panel';

/** CU-04: solo focos Alto/Medio justifican el despacho departamental. */
const RIESGOS_DESPACHABLES = [NivelRiesgo.Alto, NivelRiesgo.Medio];

export interface BrigadaSugerida {
  id: string;
  nombre: string;
  estadoOperativo: EstadoBrigada;
  distanciaKm: number;
}

export interface OrdenDeSalida {
  asignacion: AsignacionDespacho;
  incidente: { id: string; estado: EstadoIncidente; latitud: number; longitud: number };
  brigada: { id: string; nombre: string; estadoOperativo: EstadoBrigada };
  /** Contacto comunal obligatorio de la orden de salida (ACTA-002, acuerdo 5). */
  contactoComunal: { comunidad: string; nombreAutoridad: string; telefono: string; cargo: string };
}

@Injectable()
export class DespachoService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly historial: HistorialEstadoService,
    private readonly brigadas: BrigadasService,
  ) {}

  /**
   * HU-3.1 / RF-07 / RF-08 / RNF-05: Kanban del COED. Incidentes activos por columna (filtrables por trámite
   * municipal, riesgo y comunidad), contadores por columna, y brigadas con su estado táctico y foco asignado.
   */
  async panel(filtros: FiltrosPanel = { carta: null, riesgos: null, comunidad: null }) {
    const [incidentes, brigadas] = await Promise.all([
      this.dataSource.getRepository(Incidente).find({
        where: { estado: Not(EstadoIncidente.Cerrado) },
        relations: { comunidad: { contacto: true }, cartaMunicipal: true },
      }),
      this.brigadas.listar(),
    ]);
    const brigadaDe = new Map(brigadas.filter((b) => b.incidente).map((b) => [b.incidente!.id, b.nombre]));
    const tarjetas: TarjetaPanel[] = incidentes.map((i) => ({
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
      tieneCartaMunicipal: !!i.cartaMunicipal?.habilitaDespacho(),
      tieneContactoComunal: !!i.comunidad?.contacto?.validarNoVacio(),
      brigada: brigadaDe.get(i.id) ?? null,
    }));
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

  /** HU-4.1: brigadas Disponibles ordenadas por cercanía. Solo sugiere; nunca asigna sola (RS-03). */
  async sugerirBrigadas(incidenteId: string): Promise<BrigadaSugerida[]> {
    const incidente = await this.dataSource.getRepository(Incidente).findOneBy({ id: incidenteId });
    if (!incidente) throw new NotFoundException('Incidente no encontrado');
    exigirRiesgoDespachable(incidente);
    const disponibles = await this.dataSource
      .getRepository(Brigada)
      .findBy({ estadoOperativo: EstadoBrigada.Disponible });
    return disponibles
      .map((b) => ({
        id: b.id,
        nombre: b.nombre,
        estadoOperativo: b.estadoOperativo,
        distanciaKm: Math.round(distanciaKm(incidente.coordenada, b.ubicacionActual) * 100) / 100,
      }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm);
  }

  /**
   * HU-4.1: confirmación humana del despacho. Todo en una transacción; el foco pasa a "Asignado"
   * y la brigada a "En Desplazamiento". Guardas: Ley 602 (carta), contacto comunal, riesgo y disponibilidad.
   */
  async asignar(incidenteId: string, body: unknown, usuarioId: string | null = null): Promise<OrdenDeSalida> {
    const brigadaId = exigirUuid(exigirObjeto(body).brigadaId, 'brigadaId');

    return this.dataSource.transaction(async (em) => {
      const incidente = await em.findOne(Incidente, {
        where: { id: incidenteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!incidente) throw new NotFoundException('Incidente no encontrado');
      if (incidente.estado !== EstadoIncidente.Nuevo) {
        throw new ConflictException(`El incidente está "${incidente.estado}"; solo se despacha desde "Nuevo"`);
      }
      exigirRiesgoDespachable(incidente);
      await exigirCartaMunicipal(em, incidenteId);
      const contacto = await exigirContactoComunal(em, incidenteId);

      // Actualización condicional: si dos coordinadores despachan la misma brigada, solo uno gana.
      const tomada = await em.update(
        Brigada,
        { id: brigadaId, estadoOperativo: EstadoBrigada.Disponible },
        { estadoOperativo: EstadoBrigada.En_Desplazamiento },
      );
      if (!tomada.affected) {
        if (!(await em.existsBy(Brigada, { id: brigadaId }))) throw new NotFoundException('Brigada no encontrada');
        throw new ConflictException('La brigada no está Disponible');
      }
      const brigada = await em.findOneByOrFail(Brigada, { id: brigadaId });

      const asignacion = em.create(AsignacionDespacho, { incidente: { id: incidenteId }, brigada: { id: brigadaId } });
      await em.insert(AsignacionDespacho, asignacion);
      await em.update(Incidente, { id: incidenteId }, { estado: EstadoIncidente.Asignado });
      await this.historial.registrarCambio(
        em,
        incidente,
        EstadoIncidente.Nuevo,
        EstadoIncidente.Asignado,
        `Despacho confirmado por el coordinador: ${brigada.nombre}`,
        usuarioId,
      );
      const guardada = await em.findOneByOrFail(AsignacionDespacho, { id: asignacion.id });
      return {
        asignacion: guardada,
        incidente: { id: incidente.id, estado: EstadoIncidente.Asignado, ...incidente.coordenada },
        brigada: { id: brigada.id, nombre: brigada.nombre, estadoOperativo: brigada.estadoOperativo },
        contactoComunal: {
          comunidad: contacto.comunidad.nombre,
          nombreAutoridad: contacto.nombreAutoridad,
          telefono: contacto.telefono,
          cargo: contacto.cargo,
        },
      };
    });
  }
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
  contacto.comunidad = incidente.comunidad!;
  return contacto;
}
