import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { exigirEnum, exigirObjeto, exigirTelefono, exigirTexto } from '../../common/validacion';
import { Usuario } from './entities/usuario.entity';
import { Rol } from './enums/rol.enum';
import { generarToken, hashToken } from './tokens';

export interface UsuarioConToken {
  usuario: Usuario;
  /** Se muestra una sola vez: la BD solo guarda su hash. */
  token: string;
}

@Injectable()
export class SeguridadService {
  constructor(private readonly dataSource: DataSource) {}

  /** Alta de usuario por el coordinador. Devuelve el token de acceso, que no se puede recuperar después. */
  async crearUsuario(body: unknown): Promise<UsuarioConToken> {
    const datos = exigirObjeto(body);
    const nombre = exigirTexto(datos.nombre, 'nombre', 120);
    const rol = exigirEnum(datos.rol, 'rol', Object.values(Rol));
    const telefono = datos.telefono === undefined || datos.telefono === null ? null : exigirTelefono(datos.telefono);
    return registrarUsuario(this.dataSource.manager, { nombre, rol, telefono });
  }
}

/** Crea un usuario con un token dado (semilla de demostración) o uno aleatorio. */
export async function registrarUsuario(
  em: EntityManager,
  datos: { id?: string; nombre: string; rol: Rol; telefono: string | null },
  token = generarToken(),
): Promise<UsuarioConToken> {
  const usuario = em.create(Usuario, { ...datos, tokenHash: hashToken(token), activo: true });
  await em.save(Usuario, usuario);
  const guardado = await em.findOneByOrFail(Usuario, { id: usuario.id });
  return { usuario: guardado, token };
}
