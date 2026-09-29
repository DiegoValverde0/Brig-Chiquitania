import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { DataSource, Not } from 'typeorm';
import { AlmacenArchivosService, detectarTipo, sha256De, TIPOS_DOCUMENTO } from '../../common/almacen-archivos.service';
import { exigirEnum, exigirObjeto } from '../../common/validacion';
import { AuditoriaService } from '../operaciones/auditoria.service';
import { TipoEventoAuditoria } from '../operaciones/enums/tipo-evento-auditoria.enum';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { Incidente } from './entities/incidente.entity';
import { EstadoIncidente } from './enums/estado-incidente.enum';
import { EstadoTramite } from './enums/estado-tramite.enum';
import { NivelRiesgo } from './enums/nivel-riesgo.enum';

/** "PDF o imagen liviana" (Acta ACTA-002, acuerdo 1): máximo 1 MB [aprobado por el PO, Bolt 3]. */
export const PESO_MAXIMO_CARTA = 1024 * 1024;
/** Mínimo del motivo de rechazo: misma exigencia de justificación que la reclasificación (RS-03). */
export const MOTIVO_MINIMO = 15;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Estado del trámite tal como lo muestra el panel (RF-07). */
export type EstadoCartaPanel = 'sin_carta' | 'por_validar' | 'validada' | 'rechazada';

export function estadoCartaPanel(carta: CartaMunicipal | null | undefined): EstadoCartaPanel {
  if (!carta) return 'sin_carta';
  if (carta.estadoTramite === EstadoTramite.Rechazada) return 'rechazada';
  if (carta.estadoTramite === EstadoTramite.Validada) return 'validada';
  return 'por_validar';
}

export interface VistaCarta {
  id: string;
  estadoTramite: EstadoTramite;
  estado: EstadoCartaPanel;
  fechaEmision: string;
  tipoMime: string | null;
  pesoKB: number | null;
  /** false en cartas anteriores al Bolt 3 (solo referencia en texto). */
  tieneArchivo: boolean;
  motivoRechazo: string | null;
  habilitaDespacho: boolean;
}

export function vistaCarta(c: CartaMunicipal): VistaCarta {
  return {
    id: c.id,
    estadoTramite: c.estadoTramite,
    estado: estadoCartaPanel(c),
    fechaEmision: c.fechaEmision,
    tipoMime: c.tipoMime,
    pesoKB: c.pesoKB,
    tieneArchivo: !!c.sha256,
    motivoRechazo: c.motivoRechazo,
    habilitaDespacho: c.habilitaDespacho(),
  };
}

export interface FocoSinCarta {
  id: string;
  fechaReporte: Date;
  estado: EstadoIncidente;
  nivelRiesgo: NivelRiesgo | null;
  comunidad: string | null;
  carta: VistaCarta | null;
}

/**
 * CU-08 / RF-07 (Ley 602): la UGR adjunta la carta digitalizada; el coordinador puede adjuntarla como
 * contingencia (Release Plan, riesgo del Bolt 3) y la valida o la rechaza con motivo. Todo queda auditado.
 */
@Injectable()
export class CartaMunicipalService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly almacen: AlmacenArchivosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async adjuntar(
    incidenteId: string,
    cuerpo: unknown,
    fechaEmision: unknown,
    usuarioId: string,
  ): Promise<{ carta: VistaCarta; duplicada: boolean }> {
    if (!Buffer.isBuffer(cuerpo) || cuerpo.length === 0) {
      throw new UnsupportedMediaTypeException(
        `Envíe la carta como archivo binario (${TIPOS_DOCUMENTO.join(', ')}) con la cabecera x-fecha-emision`,
      );
    }
    if (cuerpo.length > PESO_MAXIMO_CARTA) {
      throw new PayloadTooLargeException('La carta supera 1 MB: escanee en menor resolución o envíe una foto comprimida');
    }
    const tipoMime = detectarTipo(cuerpo);
    if (!tipoMime) throw new UnsupportedMediaTypeException('El archivo no es un PDF ni una imagen JPEG, PNG o WebP');
    const fecha = exigirFechaEmision(fechaEmision);
    const sha256 = sha256De(cuerpo);
    const pesoKB = Math.round((cuerpo.length / 1024) * 10) / 10;

    // El archivo se escribe antes de la transacción; si la transacción falla, se borra.
    const ruta = await this.almacen.guardar(`carta-${incidenteId}`, cuerpo, sha256);
    let rutaAnterior: string | null = null;
    try {
      const resultado = await this.dataSource.transaction(async (em) => {
        const incidente = await em.findOne(Incidente, { where: { id: incidenteId }, lock: { mode: 'pessimistic_write' } });
        if (!incidente) throw new NotFoundException('Incidente no encontrado');
        if (incidente.estado === EstadoIncidente.Cerrado) throw new ConflictException('El incidente está cerrado');

        const existente = await em.findOneBy(CartaMunicipal, { incidente: { id: incidenteId } });
        if (existente?.sha256 === sha256) return { carta: existente, duplicada: true };
        // Solo se reemplaza una carta rechazada o una referencia sin archivo (anterior al Bolt 3): 0..1.
        if (existente && existente.sha256 && existente.estadoTramite !== EstadoTramite.Rechazada) {
          throw new ConflictException('El incidente ya tiene carta municipal; solo se reemplaza si fue rechazada');
        }
        const datos = {
          archivoDigital: ruta,
          fechaEmision: fecha,
          estadoTramite: EstadoTramite.Recibida,
          tipoMime,
          pesoKB,
          sha256,
          motivoRechazo: null,
        };
        let cartaId: string;
        if (existente) {
          rutaAnterior = existente.sha256 ? existente.archivoDigital : null;
          await em.update(CartaMunicipal, { id: existente.id }, datos);
          cartaId = existente.id;
        } else {
          const nueva = em.create(CartaMunicipal, { ...datos, incidente: { id: incidenteId } });
          await em.insert(CartaMunicipal, nueva);
          cartaId = nueva.id;
        }
        await this.auditoria.registrar(em, {
          tipo: existente ? TipoEventoAuditoria.CartaReemplazada : TipoEventoAuditoria.CartaAdjuntada,
          entidad: 'carta_municipal',
          entidadId: cartaId,
          incidenteId,
          detalle: `Carta ${existente ? 'reemplazada' : 'adjuntada'}: ${tipoMime}, ${pesoKB} KB, emitida el ${fecha}`,
          usuarioId,
        });
        return { carta: await em.findOneByOrFail(CartaMunicipal, { id: cartaId }), duplicada: false };
      });
      if (resultado.duplicada && resultado.carta.archivoDigital !== ruta) await this.almacen.borrar(ruta);
      if (rutaAnterior && rutaAnterior !== ruta) await this.almacen.borrar(rutaAnterior);
      return { carta: vistaCarta(resultado.carta), duplicada: resultado.duplicada };
    } catch (error) {
      // Mismo archivo que el guardado (reenvío): la ruta es idéntica y no se borra.
      const vigente = await this.dataSource.getRepository(CartaMunicipal).findOneBy({ incidente: { id: incidenteId } });
      if (vigente?.archivoDigital !== ruta) await this.almacen.borrar(ruta);
      throw error;
    }
  }

  /** CU-08: el coordinador valida la carta o la rechaza con motivo (el rechazo bloquea el despacho). */
  async verificar(incidenteId: string, body: unknown, usuarioId: string): Promise<VistaCarta> {
    const datos = exigirObjeto(body);
    const resultado = exigirEnum(datos.resultado, 'resultado', [EstadoTramite.Validada, EstadoTramite.Rechazada]);
    const motivo = typeof datos.motivo === 'string' ? datos.motivo.trim() : '';
    if (resultado === EstadoTramite.Rechazada && motivo.length < MOTIVO_MINIMO) {
      throw new BadRequestException(`El motivo del rechazo es obligatorio (mínimo ${MOTIVO_MINIMO} caracteres)`);
    }
    if (motivo.length > 500) throw new BadRequestException('El motivo no puede superar los 500 caracteres');

    return this.dataSource.transaction(async (em) => {
      const carta = await em.findOne(CartaMunicipal, {
        where: { incidente: { id: incidenteId } },
        lock: { mode: 'pessimistic_write' },
      });
      if (!carta) throw new NotFoundException('El incidente no tiene carta municipal');
      if (!carta.sha256) {
        throw new UnprocessableEntityException('La carta es una referencia sin archivo: pida a la UGR que adjunte el documento');
      }
      if (carta.estadoTramite === resultado) throw new ConflictException(`La carta ya está ${resultado}`);
      if (carta.estadoTramite === EstadoTramite.Rechazada) {
        throw new ConflictException('La carta fue rechazada: la UGR debe adjuntar una nueva');
      }
      await em.update(
        CartaMunicipal,
        { id: carta.id },
        { estadoTramite: resultado, motivoRechazo: resultado === EstadoTramite.Rechazada ? motivo : null },
      );
      await this.auditoria.registrar(em, {
        tipo: resultado === EstadoTramite.Validada ? TipoEventoAuditoria.CartaValidada : TipoEventoAuditoria.CartaRechazada,
        entidad: 'carta_municipal',
        entidadId: carta.id,
        incidenteId,
        detalle: resultado === EstadoTramite.Validada ? 'Carta validada por el coordinador' : `Carta rechazada: ${motivo}`,
        usuarioId,
      });
      return vistaCarta(await em.findOneByOrFail(CartaMunicipal, { id: carta.id }));
    });
  }

  async ver(incidenteId: string): Promise<VistaCarta> {
    const carta = await this.dataSource.getRepository(CartaMunicipal).findOneBy({ incidente: { id: incidenteId } });
    if (!carta) throw new NotFoundException('El incidente no tiene carta municipal');
    return vistaCarta(carta);
  }

  async leerArchivo(incidenteId: string): Promise<{ datos: Buffer; tipoMime: string }> {
    const carta = await this.dataSource.getRepository(CartaMunicipal).findOneBy({ incidente: { id: incidenteId } });
    if (!carta) throw new NotFoundException('El incidente no tiene carta municipal');
    if (!carta.sha256 || !carta.tipoMime) throw new NotFoundException('La carta es una referencia sin archivo adjunto');
    return { datos: await this.almacen.leer(carta.archivoDigital), tipoMime: carta.tipoMime };
  }

  /** Bandeja de la UGR: focos activos sin carta o con la carta rechazada (más urgentes primero). */
  async pendientes(): Promise<FocoSinCarta[]> {
    const incidentes = await this.dataSource.getRepository(Incidente).find({
      where: { estado: Not(EstadoIncidente.Cerrado) },
      relations: { comunidad: true, cartaMunicipal: true },
      order: { fechaReporte: 'ASC' },
    });
    const orden: Record<string, number> = { Alto: 0, Medio: 1, Bajo: 2 };
    return incidentes
      .filter((i) => !i.cartaMunicipal || i.cartaMunicipal.estadoTramite === EstadoTramite.Rechazada)
      .sort((a, b) => (orden[a.nivelRiesgo ?? ''] ?? 3) - (orden[b.nivelRiesgo ?? ''] ?? 3))
      .map((i) => ({
        id: i.id,
        fechaReporte: i.fechaReporte,
        estado: i.estado,
        nivelRiesgo: i.nivelRiesgo,
        comunidad: i.comunidad?.nombre ?? null,
        carta: i.cartaMunicipal ? vistaCarta(i.cartaMunicipal) : null,
      }));
  }
}

function exigirFechaEmision(valor: unknown): string {
  if (typeof valor !== 'string' || !FECHA.test(valor) || Number.isNaN(Date.parse(valor))) {
    throw new BadRequestException('Indique la fecha de emisión de la carta (cabecera x-fecha-emision, AAAA-MM-DD)');
  }
  if (Date.parse(valor) > Date.now() + 24 * 3600 * 1000) {
    throw new BadRequestException('La fecha de emisión no puede estar en el futuro');
  }
  return valor;
}
