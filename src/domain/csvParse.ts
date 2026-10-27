// Lector de CSV para importar listas de movimientos. Funciones puras.

const CANDIDATES = [';', ',', '\t', '|'] as const;

/** Separador más probable según la primera línea con datos (fuera de comillas). */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r\n|\n|\r/).find((l) => l.trim() !== '') ?? '';
  const counts = new Map<string, number>(CANDIDATES.map((c) => [c, 0]));
  let inQuotes = false;
  let atCellStart = true;
  for (const char of firstLine) {
    if (inQuotes) {
      if (char === '"') inQuotes = false;
    } else if (char === '"' && atCellStart) {
      // solo abre comillas al comienzo de una celda: una comilla suelta (55" TV) es texto
      inQuotes = true;
    } else if (counts.has(char)) {
      counts.set(char, counts.get(char)! + 1);
    }
    atCellStart = !inQuotes && counts.has(char);
  }
  let best: string = ',';
  let bestCount = 0;
  for (const candidate of CANDIDATES) {
    const count = counts.get(candidate)!;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * CSV con comillas ("" es una comilla), saltos de línea dentro de comillas y finales de línea \n, \r\n o \r.
 * Ignora el BOM y las filas totalmente vacías.
 */
export function parseCSV(text: string, delimiter: string = detectDelimiter(text)): { rows: string[][]; delimiter: string } {
  const source = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === delimiter) {
      endCell();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  return { rows, delimiter };
}
