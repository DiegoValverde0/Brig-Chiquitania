import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { exigirEnum, exigirObjeto, exigirPunto, exigirTexto } from '../../common/validacion';
import { PredioPrivado } from './entities/predio-privado.entity';
import { TipoPredio } from './enums/tipo-predio.enum';

export interface PredioCatalogo {
  id: string;
  nombre: string;
  tipo: TipoPredio;
  latitud: number;
  longitud: number;
}

/**
 * Catálogo de estancias y predios privados (HU-2.1). Lo mantiene el coordinador con datos validados en campo
 * (mitigación del riesgo del Bolt 2: coordenadas reales de comunidades y estancias de Santa Cruz).
 */
@Injectable()
export class PrediosService {
  constructor(private readonly dataSource: DataSource) {}

  async listar(): Promise<PredioCatalogo[]> {
    const predios = await this.dataSource.getRepository(PredioPrivado).find({ order: { nombre: 'ASC' } });
    return predios.map(aCatalogo);
  }

  async crear(body: unknown): Promise<PredioCatalogo> {
    const datos = exigirObjeto(body);
    const nombre = exigirTexto(datos.nombre, 'nombre', 120);
    const tipo = datos.tipo === undefined ? TipoPredio.Estancia : exigirEnum(datos.tipo, 'tipo', Object.values(TipoPredio));
    const punto = exigirPunto(datos);
    const repo = this.dataSource.getRepository(PredioPrivado);
    const predio = repo.create({ nombre, tipo, coordenadas: { ...punto, precisionMetros: null } });
    await repo.insert(predio);
    return aCatalogo(await repo.findOneByOrFail({ id: predio.id }));
  }
}

function aCatalogo(p: PredioPrivado): PredioCatalogo {
  return { id: p.id, nombre: p.nombre, tipo: p.tipo, latitud: p.coordenadas.latitud, longitud: p.coordenadas.longitud };
}
