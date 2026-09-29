import { BadRequestException } from '@nestjs/common';
import { EstadoIncidente } from '../triage/enums/estado-incidente.enum';
import { NivelRiesgo } from '../triage/enums/nivel-riesgo.enum';
import { OrigenRiesgo } from '../triage/enums/origen-riesgo.enum';
import { armarColumnas, FiltrosPanel, leerFiltros, TarjetaPanel } from './panel';

const SIN_FILTRO: FiltrosPanel = { carta: null, riesgos: null, comunidad: null };

function tarjeta(parcial: Partial<TarjetaPanel>): TarjetaPanel {
  return {
    id: 'x',
    estado: EstadoIncidente.Nuevo,
    nivelRiesgo: NivelRiesgo.Alto,
    origenRiesgo: OrigenRiesgo.Motor,
    justificacionRiesgo: null,
    fechaReporte: new Date('2026-09-29T10:00:00Z'),
    coordenada: { latitud: -16, longitud: -62, precisionMetros: 5 },
    comunidad: 'Concepción',
    estadoCarta: 'sin_carta',
    tieneCartaMunicipal: false,
    tieneContactoComunal: true,
    brigada: null,
    ...parcial,
  };
}

describe('leerFiltros', () => {
  it('sin parámetros no filtra', () => {
    expect(leerFiltros({})).toEqual(SIN_FILTRO);
  });

  it('lee carta, lista de riesgos y comunidad', () => {
    expect(leerFiltros({ carta: 'por_validar', riesgo: 'Alto, Medio', comunidad: ' san ' })).toEqual({
      carta: 'por_validar',
      riesgos: ['Alto', 'Medio'],
      comunidad: 'san',
    });
  });

  it('rechaza valores desconocidos (400)', () => {
    expect(() => leerFiltros({ carta: 'quizas' })).toThrow(BadRequestException);
    expect(() => leerFiltros({ riesgo: 'Extremo' })).toThrow(BadRequestException);
    expect(() => leerFiltros({ comunidad: 'x'.repeat(121) })).toThrow(BadRequestException);
  });
});

describe('armarColumnas (RF-07)', () => {
  const tarjetas = [
    tarjeta({ id: 'sin', estadoCarta: 'sin_carta' }),
    tarjeta({ id: 'por-validar', estadoCarta: 'por_validar', tieneCartaMunicipal: true, nivelRiesgo: NivelRiesgo.Medio }),
    tarjeta({ id: 'validada', estadoCarta: 'validada', tieneCartaMunicipal: true, estado: EstadoIncidente.Asignado }),
    tarjeta({ id: 'rechazada', estadoCarta: 'rechazada', comunidad: 'San Ignacio de Velasco' }),
  ];
  const ids = (f: Partial<FiltrosPanel>) => {
    const r = armarColumnas(tarjetas, { ...SIN_FILTRO, ...f });
    return Object.values(r.incidentes).flat().map((t) => t.id).sort();
  };

  it('"con carta" = adjunta y no rechazada; una rechazada cuenta como "sin carta"', () => {
    expect(ids({ carta: 'con' })).toEqual(['por-validar', 'validada']);
    expect(ids({ carta: 'sin' })).toEqual(['rechazada', 'sin']);
    expect(ids({ carta: 'por_validar' })).toEqual(['por-validar']);
  });

  it('filtra por riesgo y por comunidad sin distinguir tildes ni mayúsculas', () => {
    expect(ids({ riesgos: [NivelRiesgo.Medio] })).toEqual(['por-validar']);
    expect(ids({ comunidad: 'CONCEPCION' })).toEqual(['por-validar', 'sin', 'validada']);
  });

  it('cuenta por columna el total y los que tienen carta', () => {
    const r = armarColumnas(tarjetas, SIN_FILTRO);
    expect(r.columnas).toEqual({
      Nuevo: { total: 3, conCarta: 1 },
      Asignado: { total: 1, conCarta: 1 },
      En_Atencion: { total: 0, conCarta: 0 },
      En_Liquidacion: { total: 0, conCarta: 0 },
    });
    expect(r).toMatchObject({ total: 4, visibles: 4 });
  });

  it('ordena por riesgo y, a igual riesgo, por el reporte más antiguo', () => {
    const r = armarColumnas(
      [
        tarjeta({ id: 'bajo', nivelRiesgo: NivelRiesgo.Bajo }),
        tarjeta({ id: 'alto-reciente', fechaReporte: new Date('2026-09-29T12:00:00Z') }),
        tarjeta({ id: 'alto-antiguo', fechaReporte: new Date('2026-09-29T08:00:00Z') }),
      ],
      SIN_FILTRO,
    );
    expect(r.incidentes.Nuevo.map((t) => t.id)).toEqual(['alto-antiguo', 'alto-reciente', 'bajo']);
  });
});
