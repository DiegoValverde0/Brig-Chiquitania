import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { exigirObjeto, exigirPunto, exigirTelefono, exigirTexto } from '../../common/validacion';
import { Comunidad } from './entities/comunidad.entity';
import { ContactoComunal } from './entities/contacto-comunal.entity';

export interface ComunidadCatalogo {
  id: string;
  nombre: string;
  latitud: number;
  longitud: number;
  contacto: { nombreAutoridad: string; telefono: string; cargo: string } | null;
}

export interface Catalogo {
  /** Marca de versión: el dispositivo solo vuelve a descargar si cambió (ahorro de datos en 2G). */
  version: string;
  comunidades: ComunidadCatalogo[];
}

/**
 * HU-1.4: catálogo estático offline de comunidades habitadas y su referente comunal. El dispositivo lo guarda
 * y autocompleta el contacto sin red; el coordinador lo mantiene (validación con Eddy Chura, riesgo del Bolt 1).
 */
@Injectable()
export class CatalogoService {
  constructor(private readonly dataSource: DataSource) {}

  async catalogo(): Promise<Catalogo> {
    const comunidades = await this.dataSource
      .getRepository(Comunidad)
      .find({ relations: { contacto: true }, order: { nombre: 'ASC' } });
    let ultima = 0;
    const lista = comunidades.map((c) => {
      ultima = Math.max(ultima, c.actualizadoEn.getTime(), c.contacto?.actualizadoEn.getTime() ?? 0);
      return {
        id: c.id,
        nombre: c.nombre,
        latitud: c.coordenadas.latitud,
        longitud: c.coordenadas.longitud,
        contacto:
          c.contacto && c.contacto.validarNoVacio()
            ? { nombreAutoridad: c.contacto.nombreAutoridad, telefono: c.contacto.telefono, cargo: c.contacto.cargo }
            : null,
      };
    });
    return { version: `${lista.length}-${ultima}`, comunidades: lista };
  }

  /** Alta de una comunidad habitada, con su contacto opcional. */
  async crearComunidad(body: unknown): Promise<ComunidadCatalogo> {
    const datos = exigirObjeto(body);
    const nombre = exigirTexto(datos.nombre, 'nombre', 120);
    const punto = exigirPunto(datos);
    const contacto = datos.contacto === undefined || datos.contacto === null ? null : leerContacto(datos.contacto);
    const id = await this.dataSource.transaction(async (em) => {
      const comunidad = em.create(Comunidad, { nombre, coordenadas: { ...punto, precisionMetros: null } });
      await em.insert(Comunidad, comunidad);
      if (contacto) await guardarContacto(em, comunidad.id, contacto);
      return comunidad.id;
    });
    return this.comunidad(id);
  }

  /** Crea o corrige el referente comunal (1–1 con la comunidad). */
  async fijarContacto(comunidadId: string, body: unknown): Promise<ComunidadCatalogo> {
    const contacto = leerContacto(body);
    await this.dataSource.transaction(async (em) => {
      if (!(await em.existsBy(Comunidad, { id: comunidadId }))) throw new NotFoundException('Comunidad no encontrada');
      await guardarContacto(em, comunidadId, contacto);
    });
    return this.comunidad(comunidadId);
  }

  private async comunidad(id: string): Promise<ComunidadCatalogo> {
    const encontrada = (await this.catalogo()).comunidades.find((c) => c.id === id);
    if (!encontrada) throw new NotFoundException('Comunidad no encontrada');
    return encontrada;
  }
}

interface DatosContacto {
  nombreAutoridad: string;
  telefono: string;
  cargo: string;
}

function leerContacto(body: unknown): DatosContacto {
  const datos = exigirObjeto(body);
  return {
    nombreAutoridad: exigirTexto(datos.nombreAutoridad, 'nombreAutoridad', 120),
    telefono: exigirTelefono(datos.telefono),
    cargo: exigirTexto(datos.cargo, 'cargo', 60),
  };
}

async function guardarContacto(em: EntityManager, comunidadId: string, datos: DatosContacto): Promise<void> {
  const existente = await em.findOneBy(ContactoComunal, { comunidad: { id: comunidadId } });
  // save (no update) para que el transformer cifre los campos.
  await em.save(ContactoComunal, { ...(existente ?? {}), ...datos, comunidad: { id: comunidadId } });
}
