import { aWinAnsi, ajustar, generarPdf } from './pdf';

/** Verifica la estructura: cada entrada de la tabla xref apunta exactamente a "n 0 obj". */
function verificarXref(pdf: Buffer): number {
  const texto = pdf.toString('latin1');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(texto)![1]);
  expect(texto.slice(startxref, startxref + 4)).toBe('xref');
  const [, cantidad] = /xref\n0 (\d+)\n/.exec(texto.slice(startxref))!.map(Number);
  const entradas = texto.slice(startxref).split('\n').slice(3, 2 + cantidad);
  entradas.forEach((e, i) => {
    const offset = Number(e.slice(0, 10));
    expect(texto.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  return cantidad - 1;
}

describe('Generador de PDF propio (Bolt 5, decisión 7.1)', () => {
  const creado = new Date('2026-09-29T17:00:00Z');

  it('produce un PDF 1.4 válido: cabecera, objetos, xref exacto y %%EOF', () => {
    const pdf = generarPdf('Prueba', [{ texto: 'Hola', estilo: 'titulo' }, { texto: 'Mundo' }], 'pie', creado);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1').endsWith('%%EOF\n')).toBe(true);
    expect(verificarXref(pdf)).toBe(8); // catálogo, páginas, 3 fuentes, info, página y contenido
    expect(pdf.toString('latin1')).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
  });

  it('codifica tildes, ñ y signos en WinAnsi y escapa paréntesis y barras', () => {
    const pdf = generarPdf('T', [{ texto: 'Ñandú (atención) ¿50 % \\ ΔT ≥ 30 — “ok”?' }], 'pie', creado).toString('latin1');
    expect(pdf).toContain('(Ñandú \\(atención\\) ¿50 % \\\\ Delta T >= 30 - "ok"?) Tj');
    expect(aWinAnsi('ñ€😀')).toEqual(Buffer.from('ñEUR?', 'latin1'));
  });

  it('ajusta líneas largas y pagina cuando no entra en una hoja', () => {
    const largo = 'palabra '.repeat(200);
    expect(ajustar(largo, 'normal').length).toBeGreaterThan(10);
    expect(ajustar(largo, 'normal').every((l) => l.length <= 99)).toBe(true);
    const lineas = Array.from({ length: 150 }, (_, i) => ({ texto: `Línea ${i + 1}` }));
    const pdf = generarPdf('Largo', lineas, 'pie', creado);
    const texto = pdf.toString('latin1');
    expect(texto).toMatch(/\/Type \/Pages \/Count 3 /);
    expect(texto).toContain('Página 3 de 3');
    expect(texto).toContain('(Línea 150) Tj');
    verificarXref(pdf);
  });

  it('es determinista: mismos datos y fecha → mismos bytes', () => {
    const a = generarPdf('T', [{ texto: 'x' }], 'pie', creado);
    const b = generarPdf('T', [{ texto: 'x' }], 'pie', creado);
    expect(a.equals(b)).toBe(true);
  });
});
