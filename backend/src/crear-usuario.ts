import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { exigirEnum, exigirTelefono, exigirTexto } from './common/validacion';
import { Rol } from './core/seguridad/enums/rol.enum';
import { registrarUsuario } from './core/seguridad/seguridad.service';

/**
 * Alta de un usuario desde la consola del servidor. Sirve sobre todo para crear el PRIMER coordinador en
 * producción (después, el coordinador da de alta al resto con POST /api/usuarios).
 *
 *   node dist/crear-usuario "Nombre Apellido" Coordinador [+5917...]
 *   (en Docker: docker compose exec api node dist/crear-usuario "Nombre" Coordinador)
 *
 * Imprime el token una sola vez; la base de datos solo guarda su hash.
 */
async function crear(): Promise<void> {
  const [nombreArg, rolArg, telefonoArg] = process.argv.slice(2);
  try {
    const nombre = exigirTexto(nombreArg, 'nombre', 120);
    const rol = exigirEnum(rolArg, 'rol', Object.values(Rol));
    const telefono = telefonoArg ? exigirTelefono(telefonoArg) : null;
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
      const { usuario, token } = await registrarUsuario(app.get(DataSource).manager, { nombre, rol, telefono });
      console.log(`Usuario creado: ${usuario.nombre} (${usuario.rol}, ${usuario.id})`);
      console.log(`Token de acceso (se muestra una sola vez): ${token}`);
    } finally {
      await app.close();
    }
  } catch (error) {
    console.error(`No se pudo crear el usuario: ${(error as Error).message}`);
    console.error(`Uso: node dist/crear-usuario "Nombre" <${Object.values(Rol).join('|')}> [telefono]`);
    process.exitCode = 1;
  }
}

void crear();
