import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, In } from 'typeorm';
import { AuditoriaService } from '../operaciones/auditoria.service';
import { TipoEventoAuditoria } from '../operaciones/enums/tipo-evento-auditoria.enum';
import { Usuario } from '../seguridad/entities/usuario.entity';
import { PushService } from '../sync/push/push.service';
import { SmsService } from '../sync/sms/sms.service';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { AsignacionDespacho } from './entities/asignacion-despacho.entity';
import { Notificacion } from './entities/notificacion.entity';
import { CanalNotificacion, EstadoEnvio } from './enums/canal-notificacion.enum';
import { DatosOrden, mensajeDespachoSms } from './mensaje-despacho';
import type { ResumenNotificacion } from './panel';

const INTERVALO_BARRIDO_MS = 30000;

/**
 * CU-12 / HU-4.2 / RF-11: aviso al jefe de brigada al despachar (decisión 7.1 del PO).
 * 1) Web Push a sus dispositivos suscritos. 2) SMS de respaldo si no tiene suscripción, si el push falla o si no
 * abre la orden en `SMS_RESPALDO_MIN` minutos (3 por defecto). Cada intento queda en `notificacion` y auditado.
 * La notificación nunca revierte el despacho: si todo falla, el panel lo muestra (⚠) y el coordinador llama.
 */
@Injectable()
export class NotificacionesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NotificacionesService.name);
  private readonly respaldoMs: number;
  private barrido: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly push: PushService,
    private readonly sms: SmsService,
    private readonly auditoria: AuditoriaService,
    config: ConfigService,
  ) {
    this.respaldoMs = Number(config.get<string>('SMS_RESPALDO_MIN', '3')) * 60000;
  }

  onModuleInit(): void {
    this.barrido = setInterval(() => {
      this.revisarPendientes().catch((e: Error) => this.log.error(`Barrido de notificaciones: ${e.message}`));
    }, INTERVALO_BARRIDO_MS);
    this.barrido.unref();
  }

  onModuleDestroy(): void {
    if (this.barrido) clearInterval(this.barrido);
  }

  /** Se llama después de confirmar el despacho (fuera de la transacción). */
  async notificarDespacho(asignacionId: string): Promise<void> {
    const a = await this.cargar(asignacionId);
    const jefe = a.brigada.jefe;
    if (!jefe) return; // el despacho exige jefe con teléfono; defensa ante datos antiguos
    const orden = datosOrden(a);
    const push = await this.push.enviar(jefe.id, {
      titulo: `Despacho: FOCO-${a.incidente.id.slice(0, 8)} (${a.incidente.nivelRiesgo ?? 'sin riesgo'})`,
      cuerpo:
        `${a.rutaSugerida ?? `${orden.latitud.toFixed(5)}, ${orden.longitud.toFixed(5)}`}` +
        (orden.contacto ? `. Ref: ${orden.contacto.nombre} ${orden.contacto.telefono}` : ''),
      asignacionId,
      url: './?pestana=brigada',
    });
    if (push.intentos > 0) {
      const ok = push.enviados > 0;
      await this.registrar(a, CanalNotificacion.WebPush, mensajeDespachoSms(orden), ok, ok ? null : push.detalle);
      if (ok) return;
    }
    await this.enviarSms(a, push.intentos === 0 ? 'Sin suscripción Web Push' : 'Respaldo: el push falló');
  }

  /**
   * Barrido periódico: push sin leer tras `SMS_RESPALDO_MIN` → SMS; SMS fallido → un reintento.
   * Solo para asignaciones que siguen esperando la llegada (foco "Asignado").
   */
  async revisarPendientes(ahora = new Date()): Promise<number> {
    const limite = ahora.getTime() - this.respaldoMs;
    const pendientes = await this.dataSource.getRepository(Notificacion).find({
      where: { asignacion: { incidente: { estado: EstadoIncidente.Asignado } } },
      relations: { asignacion: true },
      order: { creadoEn: 'ASC' },
    });
    const porAsignacion = new Map<string, Notificacion[]>();
    for (const n of pendientes) {
      porAsignacion.set(n.asignacion.id, [...(porAsignacion.get(n.asignacion.id) ?? []), n]);
    }
    let enviados = 0;
    for (const [asignacionId, lista] of porAsignacion) {
      if (lista.some((n) => n.estadoEnvio === EstadoEnvio.Leida)) continue;
      const sms = lista.filter((n) => n.canal === CanalNotificacion.SMS);
      const pushSinLeer = lista.find(
        (n) => n.canal === CanalNotificacion.WebPush && n.estadoEnvio === EstadoEnvio.Enviada && n.enviadaEn!.getTime() <= limite,
      );
      let motivo: string | null = null;
      if (pushSinLeer && sms.length === 0) motivo = `Respaldo: push sin leer en ${this.respaldoMs / 60000} min`;
      else if (sms.length === 1 && sms[0].estadoEnvio === EstadoEnvio.Fallida) motivo = 'Reintento del SMS fallido';
      if (!motivo) continue;
      await this.enviarSms(await this.cargar(asignacionId), motivo);
      enviados++;
    }
    return enviados;
  }

  /** Acuse de recibo: el jefe de esa brigada abrió la orden en la app. */
  async marcarLeida(asignacionId: string, usuario: Usuario): Promise<{ leida: true }> {
    const a = await this.dataSource.getRepository(AsignacionDespacho).findOne({
      where: { id: asignacionId },
      relations: { brigada: { jefe: true } },
    });
    if (!a) throw new NotFoundException('Asignación no encontrada');
    if (a.brigada.jefe?.id !== usuario.id) throw new ForbiddenException('La orden es de otra brigada');
    await this.dataSource
      .getRepository(Notificacion)
      .update(
        { asignacion: { id: asignacionId }, estadoEnvio: In([EstadoEnvio.Enviada, EstadoEnvio.Pendiente]) },
        { estadoEnvio: EstadoEnvio.Leida, leidaEn: () => 'now()' },
      );
    return { leida: true };
  }

  /** Estado del aviso de la asignación más reciente de cada incidente (para el panel y "Mi brigada"). */
  async resumenPorIncidente(incidenteIds: string[]): Promise<Map<string, ResumenNotificacion>> {
    const resumen = new Map<string, ResumenNotificacion>();
    if (!incidenteIds.length) return resumen;
    const lista = await this.dataSource.getRepository(Notificacion).find({
      where: { asignacion: { incidente: { id: In(incidenteIds) } } },
      relations: { asignacion: { incidente: true } },
      order: { creadoEn: 'DESC' },
    });
    const asignacionDe = new Map<string, string>();
    for (const n of lista) {
      const incidenteId = n.asignacion.incidente.id;
      // Solo la asignación más reciente del incidente (un foco reactivado puede tener varias).
      if (!asignacionDe.has(incidenteId)) asignacionDe.set(incidenteId, n.asignacion.id);
      if (asignacionDe.get(incidenteId) !== n.asignacion.id) continue;
      const previo = resumen.get(incidenteId);
      const leida = n.estadoEnvio === EstadoEnvio.Leida || !!previo?.leida;
      if (!previo) resumen.set(incidenteId, { canal: n.canal, estado: n.estadoEnvio, leida });
      else if (leida) previo.leida = true;
    }
    // Si algún canal entregó, no se muestra como fallida aunque el último intento haya fallado.
    for (const [incidenteId, r] of resumen) {
      if (r.estado === EstadoEnvio.Fallida) {
        const entregada = lista.find(
          (n) =>
            n.asignacion.id === asignacionDe.get(incidenteId) &&
            (n.estadoEnvio === EstadoEnvio.Enviada || n.estadoEnvio === EstadoEnvio.Leida),
        );
        if (entregada) Object.assign(r, { canal: entregada.canal, estado: entregada.estadoEnvio });
      }
    }
    return resumen;
  }

  private async enviarSms(a: AsignacionDespacho, motivo: string): Promise<void> {
    const telefono = a.brigada.jefe?.telefono;
    const texto = mensajeDespachoSms(datosOrden(a));
    if (!telefono) {
      await this.registrar(a, CanalNotificacion.SMS, texto, false, 'El jefe no tiene teléfono registrado');
      return;
    }
    const r = await this.sms.enviarConEstado(telefono, texto, a.incidente.id);
    await this.registrar(a, CanalNotificacion.SMS, r.texto, r.enviado, r.enviado ? motivo : `${motivo}. ${r.detalle}`);
  }

  private async registrar(
    a: AsignacionDespacho,
    canal: CanalNotificacion,
    contenido: string,
    enviada: boolean,
    detalle: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      await em.insert(Notificacion, {
        asignacion: { id: a.id },
        canal,
        contenido,
        estadoEnvio: enviada ? EstadoEnvio.Enviada : EstadoEnvio.Fallida,
        detalle,
        enviadaEn: enviada ? new Date() : null,
      });
      await this.auditoria.registrar(em, {
        tipo: enviada ? TipoEventoAuditoria.NotificacionEnviada : TipoEventoAuditoria.NotificacionFallida,
        entidad: 'brigada',
        entidadId: a.brigada.id,
        incidenteId: a.incidente.id,
        detalle: `${canal} a ${a.brigada.nombre}${detalle ? `: ${detalle}` : ''}`,
        usuarioId: null,
      });
    });
    if (!enviada) this.log.warn(`Notificación ${canal} fallida (${a.brigada.nombre}): ${detalle}`);
  }

  private cargar(asignacionId: string): Promise<AsignacionDespacho> {
    return this.dataSource.getRepository(AsignacionDespacho).findOneOrFail({
      where: { id: asignacionId },
      relations: { brigada: { jefe: true }, incidente: { comunidad: { contacto: true } } },
    });
  }
}

/** Datos de la orden de salida para el mensaje (Acta ACTA-002, acuerdo 5: contacto comunal obligatorio). */
export function datosOrden(a: AsignacionDespacho): DatosOrden {
  const contacto = a.incidente.comunidad?.contacto;
  return {
    incidenteId: a.incidente.id,
    nivelRiesgo: a.incidente.nivelRiesgo,
    latitud: a.incidente.coordenada.latitud,
    longitud: a.incidente.coordenada.longitud,
    ruta: a.rutaSugerida,
    contacto:
      contacto && contacto.validarNoVacio()
        ? { nombre: contacto.nombreAutoridad, telefono: contacto.telefono, cargo: contacto.cargo }
        : null,
  };
}
