import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReporteService, VistaReporte } from '../../reporte/reporte.service';
import { TipoReporte } from '../../reporte/enums/tipo-reporte.enum';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { decodificarReporte, ErrorSms, ReporteSms, smsPlano } from './codec-sms';
import { DireccionSms, EstadoSms, MensajeSms } from './mensaje-sms.entity';
import { PasarelaSms } from './pasarela-sms';

export interface ResultadoSmsEntrante {
  estado: EstadoSms.Procesado | EstadoSms.Rechazado;
  /** Presente si se creó o reconoció el reporte. */
  reporte: VistaReporte | null;
  duplicado: boolean;
  /** Motivo del rechazo, si lo hubo. */
  motivo: string | null;
  /** Texto de la respuesta enviada al remitente. */
  respuesta: string;
}

/**
 * HU-1.3 / RNF-02: canal de contingencia SMS. Un SMS entrante con el formato BRC1 se convierte en el mismo
 * reporte que habría llegado por datos (misma validación, mismo UUID ⇒ sin duplicados) y el remitente recibe
 * una confirmación con el riesgo y el contacto comunal (HU-1.4).
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger('SmsService');

  constructor(
    private readonly dataSource: DataSource,
    private readonly reportes: ReporteService,
    @Inject(PasarelaSms) private readonly pasarela: PasarelaSms,
  ) {}

  async recibir(numero: string, texto: string, remitente: Usuario | null = null): Promise<ResultadoSmsEntrante> {
    const usuario = remitente ?? (await this.usuarioPorTelefono(numero));
    let sms: ReporteSms;
    try {
      sms = decodificarReporte(texto);
    } catch (error) {
      if (!(error instanceof ErrorSms)) throw error;
      return this.rechazar(numero, texto, error.message, null);
    }

    const cuerpo =
      sms.tipo === 'G'
        ? {
            id: sms.id,
            tipoReporte: TipoReporte.GPS,
            latitud: sms.latitud,
            longitud: sms.longitud,
            precisionMetros: sms.precisionMetros,
            fechaReporte: sms.fecha.toISOString(),
          }
        : {
            id: sms.id,
            tipoReporte: TipoReporte.Distancia,
            comunidadId: sms.comunidadId,
            rumbo: sms.rumbo,
            distanciaKm: sms.distanciaKm,
            fechaReporte: sms.fecha.toISOString(),
          };
    try {
      const { reporte, duplicado } = await this.reportes.reportar(
        this.reportes.interpretar(cuerpo),
        usuario?.id ?? null,
        'SMS',
      );
      await this.registrar(DireccionSms.Entrante, numero, texto, EstadoSms.Procesado, {
        detalle: duplicado ? 'Reporte ya registrado (reintento)' : 'Reporte creado',
        incidenteId: reporte.id,
      });
      const respuesta = await this.enviar(numero, confirmacion(reporte), reporte.id);
      return { estado: EstadoSms.Procesado, reporte, duplicado, motivo: null, respuesta };
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      return this.rechazar(numero, texto, mensajeDe(error), sms.id);
    }
  }

  /** Envía un SMS por la pasarela activa y lo deja registrado. Devuelve el texto final enviado. */
  async enviar(numero: string, texto: string, incidenteId: string | null = null): Promise<string> {
    return (await this.enviarConEstado(numero, texto, incidenteId)).texto;
  }

  /** Igual que `enviar`, pero informa si la pasarela lo aceptó (notificaciones del Bolt 4). */
  async enviarConEstado(
    numero: string,
    texto: string,
    incidenteId: string | null = null,
  ): Promise<{ texto: string; enviado: boolean; detalle: string | null }> {
    const plano = smsPlano(texto);
    try {
      const { idProveedor } = await this.pasarela.enviar(numero, plano);
      await this.registrar(DireccionSms.Saliente, numero, plano, EstadoSms.Enviado, { idProveedor, incidenteId });
      return { texto: plano, enviado: true, detalle: null };
    } catch (error) {
      this.log.warn(`No se pudo enviar el SMS: ${(error as Error).message}`);
      await this.registrar(DireccionSms.Saliente, numero, plano, EstadoSms.Fallido, {
        detalle: (error as Error).message,
        incidenteId,
      });
      return { texto: plano, enviado: false, detalle: (error as Error).message };
    }
  }

  async listar(limite = 100): Promise<MensajeSms[]> {
    return this.dataSource.getRepository(MensajeSms).find({ order: { creadoEn: 'DESC' }, take: limite });
  }

  private async rechazar(
    numero: string,
    texto: string,
    motivo: string,
    incidenteId: string | null,
  ): Promise<ResultadoSmsEntrante> {
    await this.registrar(DireccionSms.Entrante, numero, texto, EstadoSms.Rechazado, { detalle: motivo, incidenteId });
    const respuesta = await this.enviar(numero, `BRC1 ERR ${motivo}. Reintente o llame a la central.`, incidenteId);
    return { estado: EstadoSms.Rechazado, reporte: null, duplicado: false, motivo, respuesta };
  }

  private async registrar(
    direccion: DireccionSms,
    numero: string,
    texto: string,
    estado: EstadoSms,
    extra: { detalle?: string; idProveedor?: string; incidenteId?: string | null },
  ): Promise<void> {
    await this.dataSource.getRepository(MensajeSms).save({
      direccion,
      numero,
      texto,
      estado,
      detalle: extra.detalle ?? null,
      proveedor: this.pasarela.nombre,
      idProveedor: extra.idProveedor ?? null,
      incidenteId: extra.incidenteId ?? null,
    });
  }

  /** El teléfono está cifrado en la BD: se compara en memoria (pocos usuarios por despliegue). */
  private async usuarioPorTelefono(numero: string): Promise<Usuario | null> {
    const usuarios = await this.dataSource.getRepository(Usuario).findBy({ activo: true });
    return usuarios.find((u) => u.telefono === numero) ?? null;
  }
}

/** Confirmación al remitente: código corto del reporte, riesgo y referente comunal. */
function confirmacion(r: VistaReporte): string {
  const contacto = r.contactoComunal
    ? ` Contacto: ${r.contactoComunal.nombreAutoridad} ${r.contactoComunal.telefono}`
    : ' Sin contacto comunal registrado.';
  const comunidad = r.comunidad ? ` (${r.comunidad.nombre})` : '';
  return `BRC1 OK ${r.id.slice(0, 8)} Riesgo ${r.nivelRiesgo ?? '?'}${comunidad}.${contacto}`;
}

function mensajeDe(error: HttpException): string {
  const respuesta = error.getResponse();
  const mensaje = typeof respuesta === 'object' && respuesta && 'message' in respuesta ? respuesta.message : error.message;
  return Array.isArray(mensaje) ? mensaje.join('; ') : String(mensaje);
}
