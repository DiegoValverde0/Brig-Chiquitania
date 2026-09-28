import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { Comunidad } from './core/reporte/entities/comunidad.entity';
import { ContactoComunal } from './core/reporte/entities/contacto-comunal.entity';
import { Brigada } from './core/despacho/entities/brigada.entity';
import { EstadoBrigada } from './core/despacho/enums/estado-brigada.enum';

/**
 * Semilla idempotente del Walking Skeleton (T4): comunidades con contacto y brigadas con ubicación.
 * IDs fijos ⇒ ejecutarla varias veces actualiza en lugar de duplicar (y devuelve las brigadas a Disponible).
 *
 * [inferencia] Coordenadas aproximadas de los centros poblados y contactos ficticios: solo para
 * ejercitar el flujo. El catálogo real se valida con Eddy Chura (Bolt 1 / Bolt 2).
 */
const COMUNIDADES: Array<{ id: string; nombre: string; latitud: number; longitud: number }> = [
  { id: '00000000-0000-4000-8000-000000000101', nombre: 'Concepción', latitud: -16.1333, longitud: -62.0258 },
  { id: '00000000-0000-4000-8000-000000000102', nombre: 'San Javier', latitud: -16.2747, longitud: -62.5064 },
  { id: '00000000-0000-4000-8000-000000000103', nombre: 'San Ignacio de Velasco', latitud: -16.3667, longitud: -60.95 },
  { id: '00000000-0000-4000-8000-000000000104', nombre: 'San Rafael de Velasco', latitud: -16.7869, longitud: -60.6747 },
  { id: '00000000-0000-4000-8000-000000000105', nombre: 'Santa Ana de Velasco', latitud: -16.585, longitud: -60.6883 },
  { id: '00000000-0000-4000-8000-000000000106', nombre: 'San José de Chiquitos', latitud: -17.8456, longitud: -60.7394 },
  { id: '00000000-0000-4000-8000-000000000107', nombre: 'Roboré', latitud: -18.3308, longitud: -59.7594 },
];

/** [inferencia] Dos brigadas acuarteladas en Santa Cruz de la Sierra y una destacada en San Ignacio. */
const BRIGADAS: Array<{ id: string; nombre: string; latitud: number; longitud: number }> = [
  { id: '00000000-0000-4000-8000-000000000201', nombre: 'Brigada Departamental 1', latitud: -17.7833, longitud: -63.1821 },
  { id: '00000000-0000-4000-8000-000000000202', nombre: 'Brigada Departamental 2', latitud: -17.7833, longitud: -63.1821 },
  { id: '00000000-0000-4000-8000-000000000203', nombre: 'Brigada Departamental 3', latitud: -16.3667, longitud: -60.95 },
];

async function sembrar(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const ds = app.get(DataSource);
    await ds.transaction(async (em) => {
      for (const [i, c] of COMUNIDADES.entries()) {
        await em.save(Comunidad, {
          id: c.id,
          nombre: c.nombre,
          coordenadas: { latitud: c.latitud, longitud: c.longitud, precisionMetros: null },
        });
        const n = String(i + 1).padStart(2, '0');
        await em.save(ContactoComunal, {
          id: `00000000-0000-4000-8000-0000000003${n}`,
          nombreAutoridad: `Referente de ejemplo ${c.nombre}`,
          telefono: `+5917000${n}00`,
          cargo: 'Corregidor (ejemplo)',
          comunidad: { id: c.id },
        });
      }
      for (const b of BRIGADAS) {
        await em.save(Brigada, {
          id: b.id,
          nombre: b.nombre,
          estadoOperativo: EstadoBrigada.Disponible,
          ubicacionActual: { latitud: b.latitud, longitud: b.longitud, precisionMetros: null },
        });
      }
    });
    console.log(`Semilla aplicada: ${COMUNIDADES.length} comunidades con contacto, ${BRIGADAS.length} brigadas.`);
  } finally {
    await app.close();
  }
}

void sembrar();
