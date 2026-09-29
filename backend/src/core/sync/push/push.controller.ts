import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Roles, UsuarioActual } from '../../seguridad/decoradores';
import { Usuario } from '../../seguridad/entities/usuario.entity';
import { Rol } from '../../seguridad/enums/rol.enum';
import { PushService } from './push.service';

/** Web Push (Bolt 4, RF-11): el jefe de brigada suscribe su navegador para recibir la orden de salida. */
@Controller('notificaciones')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Clave pública VAPID para `pushManager.subscribe({ applicationServerKey })`. */
  @Get('clave-publica')
  clavePublica(): { clavePublica: string } {
    return { clavePublica: this.push.claves.publica };
  }

  /** Cuerpo: la `PushSubscription` del navegador (`{ endpoint, keys: { p256dh, auth } }`). */
  @Post('suscripcion')
  @HttpCode(200)
  @Roles(Rol.JefeBrigada)
  suscribir(@UsuarioActual() usuario: Usuario, @Body() body: unknown) {
    return this.push.suscribir(usuario, body);
  }

  @Delete('suscripcion')
  @Roles(Rol.JefeBrigada)
  desuscribir(@UsuarioActual() usuario: Usuario, @Body() body: unknown) {
    return this.push.desuscribir(usuario, body);
  }
}
