import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCSV } from './csvParse';

describe('detectDelimiter', () => {
  it.each([
    ['Fecha;Monto;Detalle', ';'],
    ['Fecha,Monto,Detalle', ','],
    ['Fecha\tMonto\tDetalle', '\t'],
    ['Fecha|Monto', '|'],
    ['"Detalle, con coma";Monto', ';'], // la coma está entre comillas
    ['sin separadores', ','],
  ])('%j → %j', (line, expected) => {
    expect(detectDelimiter(line)).toBe(expected);
    expect(detectDelimiter(`﻿\n\n${line}\notra;línea`)).toBe(expected);
  });
});

describe('parseCSV', () => {
  it('filas y celdas básicas, con BOM y distintos finales de línea', () => {
    for (const eol of ['\n', '\r\n', '\r']) {
      const { rows, delimiter } = parseCSV(`﻿a;b;c${eol}1;2;3${eol}`);
      expect(delimiter).toBe(';');
      expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    }
  });

  it('comillas: separadores y saltos de línea adentro, y "" como comilla', () => {
    const { rows } = parseCSV('desc;monto\n"Cena; con ""amigos""";100\n"Línea 1\nLínea 2";5');
    expect(rows).toEqual([['desc', 'monto'], ['Cena; con "amigos"', '100'], ['Línea 1\nLínea 2', '5']]);
  });

  it('conserva celdas vacías y descarta filas totalmente vacías', () => {
    const { rows } = parseCSV('a;b;c\n1;;3\n\n;;\n4;5;');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['4', '5', '']]);
  });

  it('última fila sin salto de línea final y archivo vacío', () => {
    expect(parseCSV('a;b\n1;2').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('').rows).toEqual([]);
    expect(parseCSV('\n\n').rows).toEqual([]);
  });

  it('respeta un separador explícito', () => {
    expect(parseCSV('a,b;c', ',').rows).toEqual([['a', 'b;c']]);
  });

  it('una comilla en medio de una celda sin comillas no abre un campo entrecomillado', () => {
    expect(parseCSV('55" TV;100').rows).toEqual([['55" TV', '100']]);
  });
});
