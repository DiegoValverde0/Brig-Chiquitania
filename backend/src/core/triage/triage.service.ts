import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { exigirObjeto, exigirTexto } from '../../common/validacion';
import { CartaMunicipal } from './entities/carta-municipal.entity';
import { Incidente } from './entities/incidente.entity';
import { EstadoTramite } from './enums/estado-tramite.enum';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class TriageService {
  constructor(private readonly dataSource: DataSource) {}

  async registrarCarta(incidenteId: string, body: unknown): Promise<CartaMunicipal> {
    const datos = exigirObjeto(body);
    const archivoDigital = exigirTexto(datos.archivoDigital, 'archivoDigital', 500);
    const fechaEmision = exigirTexto(datos.fechaEmision, 'fechaEmision', 10);
    if (!FECHA.test(fechaEmision) || Number.isNaN(Date.parse(fechaEmision))) {
      throw new BadRequestException('fechaEmision debe tener el formato AAAA-MM-DD');
    }

    return this.dataSource.transaction(async (em) => {
      const incidente = await em.findOne(Incidente, {
        where: { id: incidenteId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!incidente) throw new NotFoundException('Incidente no encontrado');
      // Multiplicidad 0..1: a lo sumo una carta por incidente.
      if (await em.existsBy(CartaMunicipal, { incidente: { id: incidenteId } })) {
        throw new ConflictException('El incidente ya tiene carta municipal');
      }
      const carta = em.create(CartaMunicipal, {
        archivoDigital,
        fechaEmision,
        estadoTramite: EstadoTramite.Recibida,
        incidente: { id: incidenteId },
      });
      await em.insert(CartaMunicipal, carta);
      return em.findOneByOrFail(CartaMunicipal, { id: carta.id });
    });
  }
}
