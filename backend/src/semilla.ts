import { DataSource } from 'typeorm';
import { Comunidad } from './core/reporte/entities/comunidad.entity';
import { ContactoComunal } from './core/reporte/entities/contacto-comunal.entity';
import { Brigada } from './core/despacho/entities/brigada.entity';
import { EstadoBrigada } from './core/despacho/enums/estado-brigada.enum';
import { PredioPrivado } from './core/reporte/entities/predio-privado.entity';
import { TipoPredio } from './core/reporte/enums/tipo-predio.enum';
import { Rol } from './core/seguridad/enums/rol.enum';
import { registrarUsuario } from './core/seguridad/seguridad.service';

/**
 * Semilla idempotente del Walking Skeleton (T4): comunidades con contacto y brigadas con ubicación.
 * IDs fijos ⇒ ejecutarla varias veces actualiza en lugar de duplicar (y devuelve las brigadas a Disponible).
 *
 * [inferencia] Coordenadas aproximadas de los centros poblados y contactos ficticios: solo para
 * ejercitar el flujo. El catálogo real se valida con Eddy Chura (Bolt 1 / Bolt 2).
 */
export const COMUNIDADES: Array<{ id: string; nombre: string; latitud: number; longitud: number }> = [
  { id: '00000000-0000-4000-8000-000000000101', nombre: 'Concepción', latitud: -16.1333, longitud: -62.0258 },
  { id: '00000000-0000-4000-8000-000000000102', nombre: 'San Javier', latitud: -16.2747, longitud: -62.5064 },
  { id: '00000000-0000-4000-8000-000000000103', nombre: 'San Ignacio de Velasco', latitud: -16.3667, longitud: -60.95 },
  { id: '00000000-0000-4000-8000-000000000104', nombre: 'San Rafael de Velasco', latitud: -16.7869, longitud: -60.6747 },
  { id: '00000000-0000-4000-8000-000000000105', nombre: 'Santa Ana de Velasco', latitud: -16.585, longitud: -60.6883 },
  { id: '00000000-0000-4000-8000-000000000106', nombre: 'San José de Chiquitos', latitud: -17.8456, longitud: -60.7394 },
  { id: '00000000-0000-4000-8000-000000000107', nombre: 'Roboré', latitud: -18.3308, longitud: -59.7594 },
];

/**
 * [inferencia] Dos brigadas acuarteladas en Santa Cruz de la Sierra, una destacada en San Ignacio y (Bolt 3) otra en
 * San José de Chiquitos, para ver los 4 estados tácticos a la vez en el panel.
 */
export const BRIGADAS: Array<{ id: string; nombre: string; latitud: number; longitud: number }> = [
  { id: '00000000-0000-4000-8000-000000000201', nombre: 'Brigada Departamental 1', latitud: -17.7833, longitud: -63.1821 },
  { id: '00000000-0000-4000-8000-000000000202', nombre: 'Brigada Departamental 2', latitud: -17.7833, longitud: -63.1821 },
  { id: '00000000-0000-4000-8000-000000000203', nombre: 'Brigada Departamental 3', latitud: -16.3667, longitud: -60.95 },
  { id: '00000000-0000-4000-8000-000000000204', nombre: 'Brigada Departamental 4', latitud: -17.8456, longitud: -60.7394 },
];

/**
 * [inferencia] Estancias FICTICIAS para ejercitar la exclusión de predios privados del motor (HU-2.1):
 * una aislada, a más de 15 km de toda comunidad (un foco allí debe quedar Bajo), y otra cerca de Concepción
 * (un foco allí es Alto por la comunidad, no por la estancia). Las reales se cargan con datos de campo.
 */
export const PREDIOS: Array<{ id: string; nombre: string; latitud: number; longitud: number }> = [
  { id: '00000000-0000-4000-8000-000000000501', nombre: 'El Porvenir (ejemplo)', latitud: -16.55, longitud: -61.75 },
  { id: '00000000-0000-4000-8000-000000000502', nombre: 'La Aurora (ejemplo)', latitud: -16.1, longitud: -62.0 },
];

/**
 * Usuarios de demostración, uno por rol. Tokens fijos y públicos, SOLO para desarrollo y pruebas: en producción
 * la semilla no los crea (los usuarios reales se dan de alta con POST /api/usuarios y reciben un token aleatorio).
 */
export const USUARIOS_DEMO: Array<{ id: string; nombre: string; rol: Rol; telefono: string; token: string }> = [
  { id: '00000000-0000-4000-8000-000000000401', nombre: 'Guardaparque (demo)', rol: Rol.Guardaparque, telefono: '+59170000401', token: 'demo-guardaparque' },
  { id: '00000000-0000-4000-8000-000000000402', nombre: 'Coordinador COED (demo)', rol: Rol.Coordinador, telefono: '+59170000402', token: 'demo-coordinador' },
  { id: '00000000-0000-4000-8000-000000000403', nombre: 'Jefe de Brigada (demo)', rol: Rol.JefeBrigada, telefono: '+59170000403', token: 'demo-jefe-brigada' },
  { id: '00000000-0000-4000-8000-000000000404', nombre: 'Responsable UGR (demo)', rol: Rol.ResponsableUGR, telefono: '+59170000404', token: 'demo-ugr' },
  // Bolt 4 (decisión 7.4 del PO): sin jefe con teléfono no se despacha; un jefe demo por brigada.
  { id: '00000000-0000-4000-8000-000000000405', nombre: 'Jefe Brigada 1 (demo)', rol: Rol.JefeBrigada, telefono: '+59170000405', token: 'demo-jefe-1' },
  { id: '00000000-0000-4000-8000-000000000406', nombre: 'Jefe Brigada 2 (demo)', rol: Rol.JefeBrigada, telefono: '+59170000406', token: 'demo-jefe-2' },
  { id: '00000000-0000-4000-8000-000000000407', nombre: 'Jefe Brigada 4 (demo)', rol: Rol.JefeBrigada, telefono: '+59170000407', token: 'demo-jefe-4' },
];

/** Brigada → jefe demo (solo fuera de producción). La Brigada 3 es del jefe demo principal (`demo-jefe-brigada`). */
export const JEFES_DEMO: Record<string, string> = {
  '00000000-0000-4000-8000-000000000201': '00000000-0000-4000-8000-000000000405',
  '00000000-0000-4000-8000-000000000202': '00000000-0000-4000-8000-000000000406',
  '00000000-0000-4000-8000-000000000203': '00000000-0000-4000-8000-000000000403',
  '00000000-0000-4000-8000-000000000204': '00000000-0000-4000-8000-000000000407',
};

export const BRIGADA_DEL_JEFE_DEMO = '00000000-0000-4000-8000-000000000203';
export const JEFE_DEMO = '00000000-0000-4000-8000-000000000403';

export async function aplicarSemilla(ds: DataSource): Promise<void> {
  await ds.transaction(async (em) => {
    if (process.env.NODE_ENV !== 'production') {
      for (const u of USUARIOS_DEMO) {
        const { token, ...datos } = u;
        await registrarUsuario(em, datos, token);
      }
    }
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
    // Bolt 3/4: cada brigada con su jefe demo (solo fuera de producción, como los usuarios demo). En producción
    // el coordinador los asigna con PUT /api/brigadas/:id/jefe.
    if (process.env.NODE_ENV !== 'production') {
      for (const [brigada, jefe] of Object.entries(JEFES_DEMO)) {
        await em.update(Brigada, { id: brigada }, { jefe: { id: jefe } });
      }
    }
    for (const p of PREDIOS) {
      await em.save(PredioPrivado, {
        id: p.id,
        nombre: p.nombre,
        tipo: TipoPredio.Estancia,
        coordenadas: { latitud: p.latitud, longitud: p.longitud, precisionMetros: null },
      });
    }
  });
}
