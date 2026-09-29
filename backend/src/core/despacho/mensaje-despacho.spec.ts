import { rumboCardinal, rutaEnLineaRecta } from '../../common/geo';
import { mensajeDespachoSms } from './mensaje-despacho';

const ORDEN = {
  incidenteId: 'ab12cd34-0000-4000-8000-000000000000',
  nivelRiesgo: 'Alto',
  latitud: -16.1153,
  longitud: -62.0258,
  ruta: '165 km al NE (-16.11530, -62.02580)',
  contacto: { nombre: 'Juan Pérez', telefono: '+59170012345', cargo: 'Corregidor' },
};

describe('mensajeDespachoSms (HU-4.2, RF-11, RNF-02)', () => {
  it('lleva foco, riesgo, coordenadas, ruta y referente comunal en ≤160 caracteres GSM-7', () => {
    const sms = mensajeDespachoSms(ORDEN);
    expect(sms).toBe('DESPACHO F-ab12cd34 Alto -16.11530,-62.02580 165km NE. Ref: Juan Perez +59170012345 Corregidor. Abra la app');
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).toMatch(/^[\x20-\x7e]+$/);
  });

  it('si no entra, acorta el nombre del referente pero nunca el teléfono', () => {
    const largo = { ...ORDEN, contacto: { ...ORDEN.contacto, nombre: 'Nombre '.repeat(30), cargo: 'Cacique mayor' } };
    const sms = mensajeDespachoSms(largo);
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).toContain('+59170012345');
    expect(sms).toContain('-16.11530,-62.02580');
  });

  it('sin referente lo dice (el despacho ya lo exige; defensa ante datos antiguos)', () => {
    expect(mensajeDespachoSms({ ...ORDEN, contacto: null })).toMatch(/Sin referente comunal/);
  });
});

describe('ruta en línea recta (decisión 7.3 del PO)', () => {
  const santaCruz = { latitud: -17.7833, longitud: -63.1821 };
  const concepcion = { latitud: -16.1333, longitud: -62.0258 };

  it('rumbo de 8 puntos', () => {
    expect(rumboCardinal(santaCruz, concepcion)).toBe('NE');
    expect(rumboCardinal(concepcion, santaCruz)).toBe('SO');
    expect(rumboCardinal(concepcion, { latitud: -15, longitud: -62.0258 })).toBe('N');
    expect(rumboCardinal(concepcion, { latitud: -16.1333, longitud: -60 })).toBe('E');
  });

  it('distancia, rumbo y coordenadas del foco', () => {
    expect(rutaEnLineaRecta(santaCruz, concepcion)).toBe('221 km al NE (-16.13330, -62.02580)');
    expect(rutaEnLineaRecta(concepcion, { latitud: -16.1, longitud: -62.0258 })).toBe('3.7 km al N (-16.10000, -62.02580)');
  });
});
