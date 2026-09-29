/**
 * Generador mínimo de PDF 1.4 de texto (Bolt 5, decisión 7.1 del PO): sin librerías, como el cifrado y Web Push.
 * Fuentes estándar Helvetica / Helvetica-Bold / Courier (no se incrustan) con codificación WinAnsi (tildes, ñ,
 * ¿¡), A4, márgenes de 50 pt, ajuste de línea y salto de página automáticos. Los flujos de contenido no se
 * comprimen: el texto queda legible en el archivo (útil para auditar y para las pruebas).
 */

export type EstiloLinea = 'titulo' | 'subtitulo' | 'seccion' | 'normal' | 'nota' | 'tabla';

export interface LineaPdf {
  texto: string;
  estilo?: EstiloLinea;
  /** Sangría en puntos. */
  sangria?: number;
}

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;
const ESTILOS: Record<EstiloLinea, { fuente: 'F1' | 'F2' | 'F3'; tamano: number; antes: number }> = {
  titulo: { fuente: 'F2', tamano: 16, antes: 0 },
  subtitulo: { fuente: 'F1', tamano: 10, antes: 2 },
  seccion: { fuente: 'F2', tamano: 12, antes: 12 },
  normal: { fuente: 'F1', tamano: 10, antes: 0 },
  nota: { fuente: 'F1', tamano: 8, antes: 0 },
  tabla: { fuente: 'F3', tamano: 8, antes: 0 },
};

/** Sustituciones para caracteres que WinAnsi no tiene (el resto de Latin-1 se codifica tal cual). */
const SUSTITUTOS: Record<string, string> = {
  '—': '-',
  '–': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '…': '...',
  'Δ': 'Delta ',
  '≥': '>=',
  '≤': '<=',
  '→': '->',
  '✔': 'OK',
  '⚠': '!',
  '⟳': '*',
  '€': 'EUR',
};

/** Texto → bytes WinAnsi (Latin-1 para el rango usado). Lo que no se puede representar se reemplaza por "?". */
export function aWinAnsi(texto: string): Buffer {
  let salida = '';
  for (const c of texto) {
    const sustituto = SUSTITUTOS[c];
    if (sustituto !== undefined) salida += sustituto;
    else if (c.charCodeAt(0) <= 0xff && c.length === 1) salida += c;
    else salida += '?';
  }
  return Buffer.from(salida, 'latin1');
}

function escaparCadena(b: Buffer): string {
  // Se trabaja en latin1 para no alterar los bytes > 0x7f.
  return b.toString('latin1').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');
}

/** Corta el texto en líneas que entran en el ancho útil (ancho promedio de Helvetica ≈ 0,5 em; Courier 0,6 em). */
export function ajustar(texto: string, estilo: EstiloLinea, sangria = 0): string[] {
  const { fuente, tamano } = ESTILOS[estilo];
  const ancho = fuente === 'F3' ? 0.6 : fuente === 'F2' ? 0.56 : 0.5;
  const maximo = Math.max(10, Math.floor((ANCHO - 2 * MARGEN - sangria) / (tamano * ancho)));
  if (estilo === 'tabla') return [texto.slice(0, maximo)];
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/)) {
    if (!palabra) continue;
    if (!actual) actual = palabra;
    else if ((actual + ' ' + palabra).length <= maximo) actual += ' ' + palabra;
    else {
      lineas.push(actual);
      actual = palabra;
    }
    while (actual.length > maximo) {
      lineas.push(actual.slice(0, maximo));
      actual = actual.slice(maximo);
    }
  }
  lineas.push(actual);
  return lineas;
}

/**
 * Arma el PDF. `pie` se imprime al pie de cada página junto con "Página n de N". `creado` fija la fecha de los
 * metadatos (el informe es inmutable: se genera una sola vez).
 */
export function generarPdf(titulo: string, lineas: LineaPdf[], pie: string, creado: Date): Buffer {
  // 1) Paginación.
  const paginas: string[][] = [[]];
  let y = ALTO - MARGEN;
  const nuevaPagina = () => {
    paginas.push([]);
    y = ALTO - MARGEN;
  };
  for (const linea of lineas) {
    const estilo = linea.estilo ?? 'normal';
    const { fuente, tamano, antes } = ESTILOS[estilo];
    const sangria = linea.sangria ?? 0;
    const partes = linea.texto === '' ? [''] : ajustar(linea.texto, estilo, sangria);
    // Un título de sección no queda solo al pie de una página.
    if (estilo === 'seccion' && y - antes - tamano * 4 < MARGEN + 20) nuevaPagina();
    else y -= antes;
    for (const parte of partes) {
      const alto = tamano * 1.3;
      if (y - alto < MARGEN + 20) nuevaPagina();
      y -= alto;
      paginas[paginas.length - 1].push(
        `BT /${fuente} ${tamano} Tf ${MARGEN + sangria} ${y.toFixed(1)} Td (${escaparCadena(aWinAnsi(parte))}) Tj ET`,
      );
    }
  }

  // 2) Objetos: 1 catálogo, 2 páginas, 3-5 fuentes, 6 info, luego (página, contenido) por cada página.
  const objetos: Buffer[] = [];
  const total = paginas.length;
  const idPagina = (i: number) => 7 + i * 2;
  const fuente = (base: string) =>
    Buffer.from(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`, 'latin1');
  objetos.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  objetos.push(
    Buffer.from(
      `<< /Type /Pages /Count ${total} /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] >>`,
      'latin1',
    ),
  );
  objetos.push(fuente('Helvetica'), fuente('Helvetica-Bold'), fuente('Courier'));
  const fecha = creado.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  objetos.push(
    Buffer.concat([
      Buffer.from('<< /Title (', 'latin1'),
      Buffer.from(escaparCadena(aWinAnsi(titulo)), 'latin1'),
      Buffer.from(`) /Producer (Brig-Chiquitania MVP) /CreationDate (D:${fecha}Z) >>`, 'latin1'),
    ]),
  );
  paginas.forEach((comandos, i) => {
    const piePagina = `BT /F1 8 Tf ${MARGEN} 30 Td (${escaparCadena(aWinAnsi(`${pie}  ·  Página ${i + 1} de ${total}`))}) Tj ET`;
    const flujo = Buffer.from([...comandos, piePagina].join('\n'), 'latin1');
    objetos.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${idPagina(i) + 1} 0 R >>`,
        'latin1',
      ),
    );
    objetos.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${flujo.length} >>\nstream\n`, 'latin1'),
        flujo,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  });

  // 3) Cuerpo, tabla xref con los desplazamientos exactos y trailer.
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let desplazamiento = partes[0].length;
  const offsets: number[] = [];
  objetos.forEach((cuerpo, i) => {
    offsets.push(desplazamiento);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), cuerpo, Buffer.from('\nendobj\n', 'latin1')]);
    partes.push(obj);
    desplazamiento += obj.length;
  });
  const xref =
    `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${desplazamiento}\n%%EOF\n`;
  partes.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(partes);
}
