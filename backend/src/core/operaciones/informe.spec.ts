import { generarPdf } from '../../common/pdf';
import { DatosInforme, fechaBolivia, huellaDatos, lineasInforme } from './informe';

const d: DatosInforme = {
  incidente: {
    id: 'ab12cd34-0000-4000-8000-000000000000',
    tipoReporte: 'GPS',
    fechaReporte: new Date('2026-09-29T14:00:00Z'),
    latitud: -16.1153,
    longitud: -62.0258,
    precisionMetros: 8,
    rumbo: null,
    distanciaEstimadaKm: null,
    comunidad: 'Concepción',
    nivelRiesgo: 'Alto',
    origenRiesgo: 'Motor',
    justificacionRiesgo: 'Amenaza directa a vida humana comunitaria: Concepción a 2 km',
    reactivaciones: 0,
  },
  contacto: { nombre: 'Juan Peña', telefono: '+59170012345', cargo: 'Corregidor' },
  carta: { estado: 'Validada', fechaEmision: '2026-09-29', motivoRechazo: null },
  asignaciones: [
    { brigada: 'Brigada Departamental 3', fechaAsignacion: new Date('2026-09-29T14:20:00Z'), ruta: '118 km al O', llegada: new Date('2026-09-29T15:30:00Z') },
  ],
  notificaciones: [{ fecha: new Date('2026-09-29T14:20:05Z'), brigada: 'Brigada Departamental 3', canal: 'SMS', estado: 'Leida' }],
  tiempo: { deltaMinutos: 90, ahorroPct: 50, cumpleMeta: true },
  bitacoras: [
    { id: 'b1', fecha: new Date('2026-09-29T16:00:00Z'), nivelAgua: 'Suficiente' as never, nivelCombustible: 'OK' as never, herramientasOperativas: true, kmFajaMitigados: 1.5, porcentajeControl: 40, controlRetrocede: false, canal: 'App', brigada: 'B3', registradaPor: 'Jefe' },
    { id: 'b2', fecha: new Date('2026-09-29T18:00:00Z'), nivelAgua: 'Critica' as never, nivelCombustible: 'Reserva' as never, herramientasOperativas: false, kmFajaMitigados: 3, porcentajeControl: 30, controlRetrocede: true, canal: 'SMS', brigada: 'B3', registradaPor: 'Jefe' },
  ],
  historial: [],
  cierre: { resultado: 'Controlado', fecha: new Date('2026-09-29T20:00:00Z'), coordinador: 'Coordinador COED', justificacion: null },
};

describe('Informe Técnico Consolidado (HU-5.4, RF-13)', () => {
  it('fechas en hora de Bolivia (UTC-4)', () => {
    expect(fechaBolivia(new Date('2026-09-29T17:05:00Z'))).toBe('29/09/2026 13:05');
  });

  it('compila foco, referente, carta, despacho, ΔT, bitácoras y cierre', () => {
    const texto = lineasInforme(d).map((l) => l.texto).join('\n');
    expect(texto).toContain('Informe Técnico Consolidado de Incidente');
    expect(texto).toContain('FOCO-ab12cd34 · Resultado: Controlado');
    expect(texto).toContain('Referente comunal: Juan Peña · +59170012345 (Corregidor)');
    expect(texto).toContain('Carta municipal: Validada');
    expect(texto).toContain('ΔT (reporte -> llegada) = 90 min · línea base 180 min · ahorro 50 % · cumple la meta del 30 %');
    expect(texto).toMatch(/29\/09\/2026 14:00 +Crítica +Reserva +Fallas +3 +30 %! +SMS/);
    expect(texto).toContain('el control bajó');
    expect(texto).toContain(`Huella de los datos compilados (SHA-256): ${huellaDatos(d)}`);
  });

  it('un falso positivo sin despacho lo dice y muestra su justificación', () => {
    const fp: DatosInforme = {
      ...d,
      carta: null,
      asignaciones: [],
      notificaciones: [],
      tiempo: null,
      bitacoras: [],
      cierre: { ...d.cierre, resultado: 'Falso_Positivo', justificacion: 'Quema controlada autorizada por la ABT' },
    };
    const texto = lineasInforme(fp).map((l) => l.texto).join('\n');
    expect(texto).toContain('Resultado: Falso positivo');
    expect(texto).toContain('Justificación del falso positivo: Quema controlada autorizada por la ABT');
    expect(texto).toContain('No se despachó ninguna brigada.');
    expect(texto).toContain('el ΔT no aplica');
  });

  it('el PDF resultante contiene el texto (flujos sin comprimir) y cabe en pocas páginas', () => {
    const pdf = generarPdf('Informe', lineasInforme(d), 'pie', d.cierre.fecha).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(Informe Técnico Consolidado de Incidente) Tj');
    expect(Number(/\/Count (\d+)/.exec(pdf)![1])).toBeLessThanOrEqual(2);
  });
});
