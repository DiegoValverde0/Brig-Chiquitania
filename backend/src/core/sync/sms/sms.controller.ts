import { Body, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { exigirObjeto, exigirTelefono, exigirTexto } from '../../../common/validacion';
import { Publico, Roles, UsuarioActual } from '../../seguridad/decoradores';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Rol } from '../../seguridad/enums/rol.enum';
import { MensajeSms } from './mensaje-sms.entity';
import { ResultadoSmsEntrante, SmsService } from './sms.service';

const SECRETO_DESARROLLO = 'secreto-sms-solo-desarrollo';

@Controller('sms')
export class SmsController {
  private readonly secreto: Buffer;

  constructor(
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {
    const secreto = config.get<string>('SMS_WEBHOOK_SECRETO');
    if (!secreto && process.env.NODE_ENV === 'production') {
      throw new Error('SMS_WEBHOOK_SECRETO es obligatorio en producción');
    }
    this.secreto = digest(secreto ?? SECRETO_DESARROLLO);
  }

  /**
   * Webhook del proveedor SMS: el proveedor real (o el simulador) entrega aquí cada SMS entrante.
   * Se autentica con la cabecera `x-sms-secreto`, no con token de usuario (el remitente puede ser un comunario).
   * Siempre responde 200 con el resultado: un SMS inválido no es un error del proveedor.
   */
  @Post('entrante')
  @Publico()
  @HttpCode(200)
  entrante(@Headers('x-sms-secreto') secreto: string | undefined, @Body() body: unknown): Promise<ResultadoSmsEntrante> {
    if (!secreto || !timingSafeEqual(digest(secreto), this.secreto)) {
      throw new UnauthorizedException('Secreto del webhook SMS inválido');
    }
    const datos = exigirObjeto(body);
    return this.sms.recibir(exigirTelefono(datos.de, 'de'), exigirTexto(datos.texto, 'texto', 480));
  }

  /**
   * Simulador (sin proveedor contratado): la app entrega el SMS que el teléfono habría enviado, y recorre el
   * mismo camino que un SMS real. El remitente es el usuario autenticado.
   */
  @Post('simulador')
  @HttpCode(200)
  simular(@UsuarioActual() usuario: Usuario, @Body() body: unknown): Promise<ResultadoSmsEntrante> {
    const datos = exigirObjeto(body);
    const numero = datos.de === undefined ? (usuario.telefono ?? '+59100000000') : exigirTelefono(datos.de, 'de');
    return this.sms.recibir(numero, exigirTexto(datos.texto, 'texto', 480), usuario);
  }

  /** Número de la central al que la app dirige el SMS de contingencia, y pasarela activa. */
  @Get('configuracion')
  configuracion(): { numeroCentral: string | null; proveedor: string } {
    return {
      numeroCentral: this.config.get<string>('SMS_NUMERO_CENTRAL') ?? null,
      proveedor: this.config.get<string>('SMS_PROVEEDOR') ?? 'simulado',
    };
  }

  /** Bandeja de SMS entrantes y salientes (revisión de la pasarela simulada). */
  @Get('mensajes')
  @Roles(Rol.Coordinador)
  mensajes(): Promise<MensajeSms[]> {
    return this.sms.listar();
  }
}

function digest(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest();
}
