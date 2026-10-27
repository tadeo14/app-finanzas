import { describe, expect, it } from 'vitest';
import {
  buildImportPlan,
  detectDateFormat,
  detectMapping,
  guessMappingFromData,
  EMPTY_MAPPING,
  importTemplateCSV,
  looksLikeHeader,
  parseAmountText,
  parseCurrencyText,
  parseDateText,
  parseTypeText,
  type ColumnMapping,
  type ImportOptions,
  type PlanInput,
} from './importMovements';
import { parseCSV } from './csvParse';
import type { Account, Category } from './types';

describe('detectMapping', () => {
  it('encabezados simples', () => {
    expect(detectMapping(['Fecha', 'Descripción', 'Monto', 'Categoría', 'Cuenta'])).toEqual({
      ...EMPTY_MAPPING, date: 0, description: 1, amount: 2, category: 3, account: 4,
    });
  });

  it('el CSV que exporta esta app se reconoce solo (y "Cuenta destino" no pisa a la cuenta)', () => {
    const headers = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Cuenta o tarjeta', 'Cuenta destino', 'Monto', 'Moneda', 'Monto destino', 'Moneda destino', 'Cuota'];
    expect(detectMapping(headers)).toEqual({ ...EMPTY_MAPPING, date: 0, type: 1, description: 2, category: 3, account: 4, amount: 6, currency: 7 });
  });

  it('débito y crédito separados, y mayúsculas y tildes', () => {
    expect(detectMapping(['FECHA', 'Concepto', 'Débito', 'Crédito', 'Saldo'])).toEqual({ ...EMPTY_MAPPING, date: 0, description: 1, debit: 2, credit: 3 });
  });

  it('con una columna de monto se ignoran débito y crédito', () => {
    const mapping = detectMapping(['Fecha', 'Monto', 'Ingresos', 'Gastos']);
    expect(mapping).toMatchObject({ amount: 1, debit: null, credit: null });
  });

  it('inglés, y "tipo de cambio" no es el tipo', () => {
    expect(detectMapping(['Date', 'Description', 'Amount', 'Category'])).toMatchObject({ date: 0, description: 1, amount: 2, category: 3 });
    expect(detectMapping(['Fecha', 'Tipo de cambio', 'Monto'])).toMatchObject({ type: null, amount: 2 });
  });

  it('una columna no se usa para dos datos y lo desconocido queda sin asignar', () => {
    expect(detectMapping(['Hola', 'Chau'])).toEqual(EMPTY_MAPPING);
    const m = detectMapping(['Monto', 'Monto total en pesos']);
    expect(m.amount).toBe(0);
  });
});

describe('looksLikeHeader', () => {
  it('una fila de texto es encabezado; una con fecha o monto no', () => {
    expect(looksLikeHeader(['Fecha', 'Detalle', 'Monto'])).toBe(true);
    expect(looksLikeHeader(['15/10/2026', 'Coto', '-500,00'])).toBe(false);
    expect(looksLikeHeader(['Coto', '1500'])).toBe(false);
  });
});

describe('guessMappingFromData', () => {
  it('sin encabezado: fecha, texto y monto por su contenido, en cualquier orden', () => {
    const rows = [['Coto', '-1.500,00', '15/10/2026'], ['Luz', '-2.000,00', '16/10/2026'], ['Sueldo', '800.000,00', '17/10/2026']];
    expect(guessMappingFromData(rows)).toEqual({ date: 2, amount: 1, description: 0 });
  });

  it('con monto y saldo se queda con la primera columna de montos', () => {
    const rows = [['15/10/2026', 'Coto', '-1500', '98500'], ['16/10/2026', 'Luz', '-2000', '96500']];
    expect(guessMappingFromData(rows)).toMatchObject({ date: 0, amount: 2, description: 1 });
  });

  it('no inventa columnas que no están', () => {
    expect(guessMappingFromData([['hola', 'chau'], ['uno', 'dos']])).toEqual({ description: 0 });
    expect(guessMappingFromData([])).toEqual({});
  });

  it('un par de filas raras no alcanzan: hace falta que la mitad lo cumpla', () => {
    const rows = [['x', 'a'], ['y', 'b'], ['z', 'c'], ['15/10/2026', 'd']];
    expect(guessMappingFromData(rows).date).toBeUndefined();
  });
});

describe('fechas', () => {
  it.each([
    ['15/10/2026', 'dmy', '2026-10-15'],
    ['5/3/2026', 'dmy', '2026-03-05'],
    ['05-03-26', 'dmy', '2026-03-05'],
    ['15.10.2026', 'dmy', '2026-10-15'],
    ['10/15/2026', 'mdy', '2026-10-15'],
    ['2026-10-15', 'ymd', '2026-10-15'],
    ['2026/10/15', 'auto', '2026-10-15'],
    ['15/10/2026 14:30', 'dmy', '2026-10-15'],
    ['2026-10-15T08:00:00', 'auto', '2026-10-15'],
  ])('%s (%s) → %s', (text, format, expected) => {
    expect(parseDateText(text, format as 'dmy')).toBe(expected);
  });

  it.each(['', 'ayer', '31/02/2026', '32/01/2026', '15/13/2026', '15/10/1800', '15/10', '1/2/3/4'])('"%s" no es una fecha', (text) => {
    expect(parseDateText(text, 'dmy')).toBeNull();
  });

  it('detectDateFormat', () => {
    expect(detectDateFormat(['01/02/2026', '15/02/2026'])).toBe('dmy');
    expect(detectDateFormat(['01/02/2026', '02/15/2026'])).toBe('mdy');
    expect(detectDateFormat(['2026-01-02'])).toBe('ymd');
    expect(detectDateFormat(['01/02/2026', '03/04/2026'])).toBe('dmy'); // ambiguo: día/mes/año
    expect(detectDateFormat(['basura', ''])).toBe('dmy');
  });
});

describe('parseAmountText', () => {
  it.each([
    ['1.234,56', 'auto', 123456],
    ['1,234.56', 'auto', 123456],
    ['1234,56', 'auto', 123456],
    ['1234.56', 'auto', 123456],
    ['1.234', 'auto', 123400],
    ['1,234', 'auto', 123400],
    ['1.234.567', 'auto', 123456700],
    ['12,5', 'auto', 1250],
    ['$ 1.000,00', 'auto', 100000],
    ['US$ 10,25', 'auto', 1025],
    ['ARS 500', 'auto', 50000],
    ['-500', 'auto', -50000],
    ['−500,50', 'auto', -50050],
    ['(1.234,56)', 'auto', -123456],
    ['1234,56-', 'auto', -123456],
    ['+80', 'auto', 8000],
    ['0,05', 'auto', 5],
    ['1.234', 'comma', 123400],
    ['1,234', 'dot', 123400],
  ])('%s (%s) → %i', (text, mark, expected) => {
    expect(parseAmountText(text, mark as 'auto')).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3,4x', '12,345,67', '1.2345,6789', '--5', '$', '1.5.5', '10,999'])('"%s" no es un monto', (text) => {
    expect(parseAmountText(text, 'comma')).toBeNull();
  });

  it('no redondea en silencio más de 2 decimales', () => {
    expect(parseAmountText('1,234', 'comma')).toBeNull();
    expect(parseAmountText('10.999', 'dot')).toBeNull();
    expect(parseAmountText('1.234', 'dot')).toBeNull();
  });

  it('separadores de miles mal formados no son un monto', () => {
    for (const text of ['12,345,67', '1.5.5', '1,23,456', '1.234,567.89', '12.34.567', '1.2345.678']) {
      expect(parseAmountText(text, 'auto')).toBeNull();
    }
  });

  it('sin parte entera: ",50" es 0,50', () => {
    expect(parseAmountText(',50', 'auto')).toBe(50);
    expect(parseAmountText('.5', 'dot')).toBe(50);
  });
});

describe('tipo y moneda', () => {
  it.each([
    ['Gasto', 'expense'], ['EGRESO', 'expense'], ['Débito', 'expense'], ['Ingreso', 'income'], ['crédito', 'income'], ['Income', 'income'],
    ['Transferencia', 'transfer'], ['Transfer', 'transfer'], ['Cuota de tarjeta', 'card'], ['otra cosa', null], ['', null],
  ])('%s → %s', (text, expected) => {
    expect(parseTypeText(text)).toBe(expected);
  });

  it.each([['ARS', 'ARS'], ['$', 'ARS'], ['Pesos', 'ARS'], ['USD', 'USD'], ['U$S', 'USD'], ['Dólares', 'USD'], ['EUR', null], ['', null]])('moneda %s → %s', (text, expected) => {
    expect(parseCurrencyText(text)).toBe(expected);
  });
});

// ---------- plan ----------

const pesos: Account = { id: 'pesos', name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 0, archived: false };
const efectivo: Account = { id: 'efectivo', name: 'Efectivo', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false };
const dolares: Account = { id: 'usd', name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 0, archived: false };
const categories: Category[] = [
  { id: 'comida', name: 'Comida', kind: 'expense' },
  { id: 'super', name: 'Supermercado', kind: 'expense', parentId: 'comida' },
  { id: 'nafta', name: 'Combustible', kind: 'expense' },
  { id: 'sueldo', name: 'Sueldo', kind: 'income' },
  { id: 'otros-g', name: 'Otros', kind: 'expense' },
  { id: 'otros-i', name: 'Otros', kind: 'income' },
];

const options: ImportOptions = { defaultAccountId: 'pesos', dateFormat: 'auto', decimal: 'auto', expensesArePositive: false, createCategories: true };
const simple: ColumnMapping = { ...EMPTY_MAPPING, date: 0, description: 1, amount: 2, category: 3 };

function plan(csv: string, over: Partial<PlanInput> = {}, opts: Partial<ImportOptions> = {}, mapping: ColumnMapping = simple) {
  const { rows } = parseCSV(csv);
  return buildImportPlan({
    rows, firstLine: 2, mapping, options: { ...options, ...opts },
    accounts: [pesos, efectivo, dolares], categories, existing: [], ...over,
  });
}

describe('buildImportPlan: tipo y monto', () => {
  const csv = '15/10/2026;Coto;-12345,67;Supermercado\n16/10/2026;Sueldo;800000;Sueldo\n17/10/2026;Nafta;-40.000,00;Combustible';

  it('el signo decide: negativo es gasto y positivo es ingreso', () => {
    const p = plan(csv);
    expect(p.items.map((i) => [i.line, i.status, i.draft?.type, i.draft?.amount, i.draft?.date])).toEqual([
      [2, 'ok', 'expense', 1_234_567, '2026-10-15'],
      [3, 'ok', 'income', 80_000_000, '2026-10-16'],
      [4, 'ok', 'expense', 4_000_000, '2026-10-17'],
    ]);
    expect(p.counts).toMatchObject({ ok: 3, expense: 2, income: 1, error: 0 });
    expect(p.totals.ARS).toEqual({ expense: 5_234_567, income: 80_000_000 });
  });

  it('gastos en positivo: se invierte el signo', () => {
    const p = plan('15/10/2026;Coto;12345,67;Supermercado\n16/10/2026;Devolución;-500;', {}, { expensesArePositive: true });
    expect(p.items.map((i) => i.draft?.type)).toEqual(['expense', 'income']);
  });

  it('avisa si todo viene positivo sin columna de tipo', () => {
    const p = plan('15/10/2026;Coto;100\n16/10/2026;Luz;200');
    expect(p.counts.income).toBe(2);
    expect(p.warnings.join(' ')).toContain('Todos los montos son positivos');
    expect(plan('15/10/2026;Coto;100', {}, { expensesArePositive: true }).warnings).toEqual([]);
  });

  it('con columna de tipo manda el tipo y el signo del monto se ignora', () => {
    const mapping = { ...EMPTY_MAPPING, date: 0, type: 1, amount: 2 };
    const p = plan('15/10/2026;Gasto;-500\n16/10/2026;Ingreso;500\n17/10/2026;egreso;500', {}, {}, mapping);
    expect(p.items.map((i) => [i.draft?.type, i.draft?.amount])).toEqual([['expense', 50000], ['income', 50000], ['expense', 50000]]);
    expect(p.warnings).toEqual([]);
  });

  it('débito y crédito en columnas separadas', () => {
    const mapping = { ...EMPTY_MAPPING, date: 0, description: 1, debit: 2, credit: 3 };
    const p = plan('15/10/2026;Luz;1.500,00;\n16/10/2026;Sueldo;;800.000,00\n17/10/2026;Raro;10;10\n18/10/2026;Vacío;;\n19/10/2026;Mal;x;', {}, {}, mapping);
    expect(p.items.map((i) => [i.status, i.draft?.type, i.draft?.amount])).toEqual([
      ['ok', 'expense', 150000], ['ok', 'income', 80000000], ['error', undefined, undefined], ['error', undefined, undefined], ['error', undefined, undefined],
    ]);
    expect(p.items[2]!.reason).toContain('débito y crédito');
    expect(p.items[3]!.reason).toBe('No tiene monto.');
    expect(p.items[4]!.reason).toContain('Monto inválido');
  });

  it('transferencias y cuotas de tarjeta se saltean con su motivo; un tipo desconocido es error', () => {
    const mapping = { ...EMPTY_MAPPING, date: 0, type: 1, amount: 2 };
    const p = plan('15/10/2026;Transferencia;100\n15/10/2026;Cuota de tarjeta;100\n15/10/2026;Rarísimo;100', {}, {}, mapping);
    expect(p.items.map((i) => i.status)).toEqual(['skipped', 'skipped', 'error']);
    expect(p.items[0]!.reason).toContain('transferencias');
    expect(p.items[1]!.reason).toContain('compra con tarjeta');
  });

  it('errores con el motivo y el número de línea', () => {
    const p = plan('31/02/2026;Mal fecha;100\n;Sin fecha;100\n15/10/2026;Sin monto;\n15/10/2026;Monto raro;abc\n15/10/2026;Cero;0');
    expect(p.items.map((i) => [i.line, i.status, i.reason])).toEqual([
      [2, 'error', 'Fecha inválida: "31/02/2026".'],
      [3, 'error', 'No tiene fecha.'],
      [4, 'error', 'No tiene monto.'],
      [5, 'error', 'Monto inválido: "abc".'],
      [6, 'error', 'El monto es cero.'],
    ]);
  });

  it('formato de fecha mes/día y separador decimal explícitos', () => {
    const p = plan('10/15/2026;Coto;-1,234', {}, { dateFormat: 'mdy', decimal: 'dot' });
    expect(p.items[0]!.draft).toMatchObject({ date: '2026-10-15', amount: 123400 });
  });

  it('sin cuenta por defecto no se puede importar', () => {
    expect(plan('15/10/2026;Coto;-5', {}, { defaultAccountId: 'nada' }).items[0]).toMatchObject({ status: 'error', reason: 'Elegí la cuenta a la que se importa.' });
  });

  it('la descripción se compacta y se limita', () => {
    const p = plan(`15/10/2026;"  Café   con\nleche ";-5\n15/10/2026;${'x'.repeat(500)};-5`);
    expect(p.items[0]!.draft?.description).toBe('Café con leche');
    expect(p.items[1]!.draft?.description).toHaveLength(200);
  });
});

describe('buildImportPlan: cuentas y moneda', () => {
  const mapping = { ...simple, account: 4, currency: 5 };

  it('usa la cuenta del archivo si existe y avisa de las que no', () => {
    const p = plan('15/10/2026;Coto;-5;;efectivo;\n15/10/2026;Luz;-5;;Mercado Pago;\n15/10/2026;Sin cuenta;-5;;;', {}, {}, mapping);
    expect(p.items.map((i) => i.draft?.accountId)).toEqual(['efectivo', 'pesos', 'pesos']);
    expect(p.warnings.join(' ')).toContain('Mercado Pago');
  });

  it('una moneda distinta a la de la cuenta es un error; la misma, no', () => {
    const p = plan('15/10/2026;Coto;-5;;;USD\n15/10/2026;Coto;-5;;;ARS\n15/10/2026;Coto;-5;;Dólares;USD\n15/10/2026;Coto;-5;;;EUR', {}, {}, mapping);
    expect(p.items.map((i) => i.status)).toEqual(['error', 'ok', 'ok', 'ok']);
    expect(p.items[0]!.reason).toContain('(USD) no coincide');
    expect(p.totals.USD.expense).toBe(500);
  });
});

describe('buildImportPlan: categorías', () => {
  it('asocia por nombre sin importar mayúsculas ni tildes, según el tipo del movimiento', () => {
    const p = plan('15/10/2026;a;-5;combustible\n15/10/2026;b;5;SUELDO\n15/10/2026;c;-5;otros\n15/10/2026;d;5;otros');
    expect(p.items.map((i) => i.draft?.category)).toEqual([{ id: 'nafta' }, { id: 'sueldo' }, { id: 'otros-g' }, { id: 'otros-i' }]);
    expect(p.newCategories).toEqual([]);
  });

  it('"Padre > Hijo": existente, hijo nuevo bajo un padre existente, y ruta nueva', () => {
    const p = plan('15/10/2026;a;-5;Comida > Supermercado\n15/10/2026;b;-5;Comida > Verdulería\n15/10/2026;c;-5;Mascotas > Veterinaria');
    expect(p.items[0]!.draft?.category).toEqual({ id: 'super' });
    expect(p.newCategories.map((c) => [c.name, c.kind, c.parent])).toEqual([
      ['Verdulería', 'expense', { id: 'comida' }],
      ['Mascotas', 'expense', undefined],
      ['Veterinaria', 'expense', { newKey: 'expense||mascotas' }],
    ]);
    expect(p.items[2]!.draft?.category).toEqual({ newKey: 'expense|new:expense||mascotas|veterinaria' });
  });

  it('las categorías nuevas se crean una sola vez y por tipo', () => {
    const p = plan('15/10/2026;a;-5;Mascotas\n16/10/2026;b;-7;mascotas\n17/10/2026;c;50;Mascotas');
    expect(p.newCategories.map((c) => [c.name, c.kind])).toEqual([['Mascotas', 'expense'], ['Mascotas', 'income']]);
    expect(p.items[0]!.draft?.category).toEqual(p.items[1]!.draft?.category);
    expect(p.items[0]!.draft?.category).not.toEqual(p.items[2]!.draft?.category);
  });

  it('sin permiso para crear, lo desconocido queda sin categoría y un hijo desconocido cae en el padre', () => {
    const p = plan('15/10/2026;a;-5;Mascotas\n15/10/2026;b;-5;Comida > Verdulería\n15/10/2026;c;-5;Nada > Combustible', {}, { createCategories: false });
    expect(p.newCategories).toEqual([]);
    expect(p.items.map((i) => i.draft?.category)).toEqual([undefined, { id: 'comida' }, { id: 'nafta' }]);
  });
});

describe('buildImportPlan: duplicados', () => {
  const existing = [{ accountId: 'pesos', type: 'expense' as const, date: '2026-10-15', amount: 1_234_567, description: 'Coto' }];

  it('un movimiento igual a uno existente se marca como duplicado (ignora mayúsculas, tildes y espacios)', () => {
    const p = plan('15/10/2026;  COTO ;-12345,67\n15/10/2026;Coto;-12345,68\n16/10/2026;Coto;-12345,67', { existing });
    expect(p.items.map((i) => i.status)).toEqual(['duplicate', 'ok', 'ok']);
    expect(p.counts).toMatchObject({ ok: 2, duplicate: 1 });
    expect(p.totals.ARS.expense).toBe(1_234_568 + 1_234_567);
  });

  it('la cuenta y el tipo cuentan', () => {
    const p = plan('15/10/2026;Coto;-12345,67\n15/10/2026;Coto;12345,67', { existing: [{ ...existing[0]!, accountId: 'efectivo' }] });
    expect(p.items.map((i) => i.status)).toEqual(['ok', 'ok']);
  });

  it('dos filas iguales en el archivo con un solo movimiento existente: una es duplicado y la otra entra (dos cafés el mismo día)', () => {
    const csv = '15/10/2026;Coto;-12345,67\n15/10/2026;Coto;-12345,67';
    expect(plan(csv, { existing }).items.map((i) => i.status)).toEqual(['duplicate', 'ok']);
    expect(plan(csv).items.map((i) => i.status)).toEqual(['ok', 'ok']);
    expect(plan(csv, { existing: [existing[0]!, existing[0]!] }).items.map((i) => i.status)).toEqual(['duplicate', 'duplicate']);
  });

  it('reimportar el mismo archivo no agrega nada', () => {
    const first = plan('15/10/2026;Coto;-5\n16/10/2026;Luz;-7');
    const existingNow = first.items.map((i) => ({ ...i.draft!, description: i.draft!.description }));
    expect(plan('15/10/2026;Coto;-5\n16/10/2026;Luz;-7', { existing: existingNow }).counts).toMatchObject({ ok: 0, duplicate: 2 });
  });
});

describe('plantilla', () => {
  it('se importa sola sin errores: con sus propios encabezados detectados', () => {
    const { rows } = parseCSV(importTemplateCSV());
    expect(looksLikeHeader(rows[0]!)).toBe(true);
    const mapping = detectMapping(rows[0]!);
    const p = buildImportPlan({ rows: rows.slice(1), firstLine: 2, mapping, options, accounts: [pesos], categories, existing: [] });
    expect(p.counts).toMatchObject({ ok: 3, error: 0, expense: 2, income: 1 });
  });
});
