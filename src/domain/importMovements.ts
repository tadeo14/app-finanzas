// Importación de listas de movimientos desde un CSV (como Mobills). Funciones puras: arman un "plan" que se puede
// mostrar en una vista previa antes de guardar nada.
import { normalizeText } from './accounts';
import { isValidDate, toDate } from './dates';
import type { Account, Category, Currency, Transaction } from './types';

export type ImportField = 'date' | 'description' | 'amount' | 'type' | 'category' | 'account' | 'currency' | 'debit' | 'credit';
/** Índice de la columna del archivo para cada dato, o null si el archivo no la trae. */
export type ColumnMapping = Record<ImportField, number | null>;
export type DateFormat = 'auto' | 'dmy' | 'mdy' | 'ymd';
export type DecimalMark = 'auto' | 'comma' | 'dot';

export interface ImportOptions {
  /** Cuenta para las filas sin cuenta (o con una cuenta que no existe). */
  defaultAccountId: string;
  dateFormat: DateFormat;
  decimal: DecimalMark;
  /** Archivos donde los gastos vienen en positivo (por ejemplo el resumen de una tarjeta). Solo sin columna de tipo. */
  expensesArePositive: boolean;
  /** Crear las categorías que no existan en vez de dejar esas filas sin categoría. */
  createCategories: boolean;
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: null, description: null, amount: null, type: null, category: null, account: null, currency: null, debit: null, credit: null,
};

// ---------- Columnas ----------

const SYNONYMS: [ImportField, string[]][] = [
  ['date', ['fecha', 'date', 'dia', 'fecha de operacion', 'fecha operacion', 'fecha valor']],
  ['amount', ['monto', 'importe', 'valor', 'amount', 'total', 'monto total']],
  ['description', ['descripcion', 'detalle', 'concepto', 'description', 'comentario', 'nota', 'observacion', 'observaciones', 'movimiento', 'referencia']],
  ['type', ['tipo', 'type', 'clase', 'naturaleza', 'tipo de movimiento']],
  ['category', ['categoria', 'category', 'rubro']],
  ['account', ['cuenta', 'account', 'cuenta o tarjeta', 'medio de pago']],
  ['currency', ['moneda', 'currency', 'divisa']],
  ['debit', ['debito', 'debitos', 'egreso', 'egresos', 'gasto', 'gastos', 'salida', 'retiro', 'debe']],
  ['credit', ['credito', 'creditos', 'ingreso', 'ingresos', 'entrada', 'deposito', 'haber']],
];

/** Encabezados que se parecen a un campo pero son otra cosa ("tipo de cambio", "cuenta destino"). */
const NOT_A_MATCH = /cambio|destino/;

/** Adivina qué columna es cada dato por el nombre del encabezado. */
export function detectMapping(headers: readonly string[]): ColumnMapping {
  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const used = new Set<number>();
  const normalized = headers.map((h) => normalizeText(h));

  const assign = (field: ImportField, test: (header: string, synonym: string) => boolean) => {
    if (mapping[field] !== null) return;
    const synonyms = SYNONYMS.find(([f]) => f === field)![1];
    const index = normalized.findIndex((h, i) => !used.has(i) && !NOT_A_MATCH.test(h) && synonyms.some((s) => test(h, s)));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  };

  // primero los nombres exactos y después los que empiezan igual ("monto total en pesos")
  for (const [field] of SYNONYMS) assign(field, (h, s) => h === s);
  for (const [field] of SYNONYMS) assign(field, (h, s) => h.startsWith(`${s} `));

  // con una columna de monto no hace falta (ni conviene) usar débito y crédito
  if (mapping.amount !== null) {
    mapping.debit = null;
    mapping.credit = null;
  }
  return mapping;
}

/**
 * Para archivos sin encabezado (o con encabezados que no se reconocen): la columna con más fechas es la fecha,
 * la que tiene más montos es el monto y la primera columna de texto que queda es la descripción.
 */
export function guessMappingFromData(rows: readonly (readonly string[])[], sample = 30): Partial<ColumnMapping> {
  const rowsToScan = rows.slice(0, sample);
  const width = Math.max(0, ...rowsToScan.map((r) => r.length));
  const score = (col: number, parse: (text: string) => unknown) =>
    rowsToScan.filter((r) => (r[col] ?? '').trim() !== '' && parse((r[col] ?? '').trim()) !== null).length;
  const minimum = Math.max(1, Math.ceil(rowsToScan.length / 2));

  const dateScores = Array.from({ length: width }, (_, c) => score(c, (t) => parseDateText(t, 'auto')));
  const dateCol = dateScores.indexOf(Math.max(...dateScores));
  const result: Partial<ColumnMapping> = {};
  if (width > 0 && dateScores[dateCol]! >= minimum) result.date = dateCol;

  const amountScores = Array.from({ length: width }, (_, c) => (c === result.date ? -1 : score(c, (t) => parseAmountText(t, 'auto'))));
  const bestAmount = Math.max(...amountScores);
  // ante un empate (por ejemplo monto y saldo) se prefiere la primera columna
  if (width > 0 && bestAmount >= minimum) result.amount = amountScores.indexOf(bestAmount);

  const textCol = Array.from({ length: width }, (_, c) => c).find(
    (c) => c !== result.date && c !== result.amount && rowsToScan.some((r) => (r[c] ?? '').trim() !== '' && parseAmountText((r[c] ?? '').trim(), 'auto') === null),
  );
  if (textCol !== undefined) result.description = textCol;
  return result;
}

/** ¿La primera fila es un encabezado? Lo es si ninguna celda parece una fecha o un monto. */
export function looksLikeHeader(row: readonly string[]): boolean {
  return !row.some((cell) => parseDateText(cell, 'auto') !== null || parseAmountText(cell, 'auto') !== null);
}

// ---------- Fechas ----------

/** 'dmy' si algún primer número pasa de 12, 'mdy' si lo pasa el segundo, 'ymd' si arranca con el año; si no, día/mes/año (Argentina). */
export function detectDateFormat(values: readonly string[]): Exclude<DateFormat, 'auto'> {
  let sawMonthFirst = false;
  for (const value of values) {
    const parts = splitDate(value);
    if (!parts) continue;
    if (parts[0]!.length === 4) return 'ymd';
    if (Number(parts[0]) > 12) return 'dmy';
    if (Number(parts[1]) > 12) sawMonthFirst = true;
  }
  return sawMonthFirst ? 'mdy' : 'dmy';
}

function splitDate(text: string): [string, string, string] | null {
  const datePart = text.trim().split(/[T\s]/)[0] ?? '';
  const match = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/.exec(datePart);
  return match ? [match[1]!, match[2]!, match[3]!] : null;
}

/** Fecha 'AAAA-MM-DD' o null. Años de 2 cifras se toman como 20xx. Ignora la hora si la hay. */
export function parseDateText(text: string, format: DateFormat): string | null {
  const parts = splitDate(text);
  if (!parts) return null;
  const resolved = format === 'auto' ? (parts[0].length === 4 ? 'ymd' : 'dmy') : format;
  let year: number, month: number, day: number;
  if (resolved === 'ymd') {
    [year, month, day] = [Number(parts[0]), Number(parts[1]), Number(parts[2])] as [number, number, number];
  } else {
    const yearText = parts[2];
    year = Number(yearText);
    if (yearText.length <= 2) year += 2000;
    [month, day] = resolved === 'dmy' ? [Number(parts[1]), Number(parts[0])] : [Number(parts[0]), Number(parts[1])];
  }
  if (year < 1990 || year > 2100) return null;
  const date = toDate(year, month, day);
  return isValidDate(date) ? date : null;
}

// ---------- Montos ----------

/**
 * Monto en centavos (con signo) o null si no es un monto válido. Acepta "1.234,56", "1,234.56", "$ 1.000",
 * "-50", "(1.234,56)" y "50-". Con más de 2 decimales no es válido: no se redondea en silencio.
 */
export function parseAmountText(text: string, mark: DecimalMark): number | null {
  let s = text.trim().replace(/ /g, ' ');
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/(?:US\$|U\$S|AR\$|ARS|USD|\$)/gi, '').replace(/\s/g, '');
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const decimal = decimalSeparatorOf(s, mark);
  let whole = s;
  let fraction = '';
  if (decimal !== null) {
    const at = s.lastIndexOf(decimal);
    whole = s.slice(0, at);
    fraction = s.slice(at + 1);
    if (!/^\d{1,2}$/.test(fraction)) return null; // 0 o más de 2 decimales: no se redondea en silencio
    if (whole === '') whole = '0';
  }
  if (!/^\d+$/.test(whole)) {
    // lo que no son dígitos tiene que ser un único tipo de separador de miles, en grupos de 3 ("1.234.567")
    if (whole.includes('.') && whole.includes(',')) return null;
    const thousands = whole.includes('.') ? '.' : ',';
    if (thousands === decimal) return null;
    if (!new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(whole)) return null;
    whole = whole.split(thousands).join('');
  }

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Cuál es el separador decimal de un número ('.' o ','), o null si no tiene. */
function decimalSeparatorOf(s: string, mark: DecimalMark): '.' | ',' | null {
  if (mark === 'comma') return s.includes(',') ? ',' : null;
  if (mark === 'dot') return s.includes('.') ? '.' : null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) return lastDot > lastComma ? '.' : ',';
  const only = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
  if (only === null) return null;
  const occurrences = s.split(only).length - 1;
  const decimals = s.length - s.lastIndexOf(only) - 1;
  // un solo separador seguido de 1 o 2 cifras es decimal; con 3 cifras (o repetido) es de miles: "1.234", "1,234,567"
  return occurrences === 1 && decimals <= 2 ? only : null;
}

// ---------- Tipo y moneda ----------

type TypeWord = 'expense' | 'income' | 'transfer' | 'card';

const EXPENSE_WORDS = ['gasto', 'gastos', 'egreso', 'egresos', 'expense', 'debito', 'salida', 'retiro', 'pago', 'despesa', 'despesas'];
const INCOME_WORDS = ['ingreso', 'ingresos', 'income', 'credito', 'entrada', 'deposito', 'cobro', 'receita', 'receitas'];

export function parseTypeText(text: string): TypeWord | null {
  const t = normalizeText(text);
  if (EXPENSE_WORDS.includes(t)) return 'expense';
  if (INCOME_WORDS.includes(t)) return 'income';
  if (t.startsWith('transfer')) return 'transfer';
  if (t.includes('cuota') || t.includes('tarjeta')) return 'card';
  return null;
}

export function parseCurrencyText(text: string): Currency | null {
  const t = normalizeText(text).replace(/[^a-z$]/g, '');
  if (['ars', 'peso', 'pesos', '$', 'arg'].includes(t)) return 'ARS';
  if (['usd', 'us$', 'u$s', 'dolar', 'dolares', 'dollar', 'dollars'].includes(t)) return 'USD';
  return null;
}

// ---------- El plan ----------

export type RowStatus = 'ok' | 'duplicate' | 'error' | 'skipped';

export type CategoryRef = { id: string } | { newKey: string };

export interface PlanItem {
  /** Número de línea del archivo (para decirle al usuario dónde está el problema). */
  line: number;
  status: RowStatus;
  reason?: string;
  draft?: {
    type: 'expense' | 'income';
    accountId: string;
    amount: number;
    date: string;
    description: string;
    category?: CategoryRef;
  };
}

export interface PlanCategory {
  key: string;
  kind: Category['kind'];
  name: string;
  /** Padre ya existente o categoría nueva del mismo plan (para "Comida > Super"). */
  parent?: CategoryRef;
}

export interface ImportPlan {
  items: PlanItem[];
  newCategories: PlanCategory[];
  warnings: string[];
  counts: { ok: number; duplicate: number; error: number; skipped: number; expense: number; income: number };
  /** Totales de lo que se importa (sin duplicados), por moneda de la cuenta. */
  totals: Record<Currency, { expense: number; income: number }>;
}

export interface PlanInput {
  /** Filas de datos (sin el encabezado). */
  rows: readonly (readonly string[])[];
  /** Número de línea de la primera fila de datos en el archivo. */
  firstLine: number;
  mapping: ColumnMapping;
  options: ImportOptions;
  accounts: readonly Account[];
  categories: readonly Category[];
  /** Movimientos que ya existen, para no duplicarlos al reimportar el mismo archivo. */
  existing: readonly Pick<Transaction, 'accountId' | 'type' | 'date' | 'amount' | 'description'>[];
}

const MAX_DESCRIPTION = 200;

export const normalizeDescription = (text: string): string => normalizeText(text).replace(/\s+/g, ' ');

/** Clave para detectar un movimiento que ya existe: misma cuenta, tipo, día, monto y descripción. */
export function movementKey(m: { accountId: string; type: string; date: string; amount: number; description: string }): string {
  return `${m.accountId}|${m.type}|${m.date}|${m.amount}|${normalizeDescription(m.description)}`;
}

export function buildImportPlan(input: PlanInput): ImportPlan {
  const { rows, mapping, options, accounts, categories, existing } = input;
  const cell = (row: readonly string[], field: ImportField): string => (mapping[field] === null ? '' : (row[mapping[field]!] ?? '').trim());

  const dateFormat = options.dateFormat === 'auto' ? detectDateFormat(rows.map((r) => cell(r, 'date'))) : options.dateFormat;
  const accountByName = new Map(accounts.map((a) => [normalizeText(a.name), a]));
  const defaultAccount = accounts.find((a) => a.id === options.defaultAccountId);

  const existingCounts = new Map<string, number>();
  for (const e of existing) {
    const key = movementKey(e);
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  const resolver = makeCategoryResolver(categories, options.createCategories);
  const items: PlanItem[] = [];
  const unknownAccounts = new Set<string>();
  let sawNegative = false;

  rows.forEach((row, index) => {
    const line = input.firstLine + index;
    const fail = (reason: string): void => void items.push({ line, status: 'error', reason });
    const skip = (reason: string): void => void items.push({ line, status: 'skipped', reason });

    if (!defaultAccount) return fail('Elegí la cuenta a la que se importa.');

    // tipo
    let type: 'expense' | 'income' | null = null;
    const typeText = cell(row, 'type');
    if (typeText !== '') {
      const word = parseTypeText(typeText);
      if (word === 'transfer') return skip('Las transferencias no se importan: cargalas desde el botón +.');
      if (word === 'card') return skip('Las cuotas de tarjeta no se importan: cargá la compra con tarjeta.');
      if (word === null) return fail(`Tipo desconocido: "${typeText}".`);
      type = word;
    }

    // monto
    let amount: number;
    if (mapping.amount === null && mapping.debit === null && mapping.credit === null) return fail('Falta indicar la columna del monto.');
    if (mapping.amount === null) {
      const debit = cell(row, 'debit') === '' ? 0 : parseAmountText(cell(row, 'debit'), options.decimal);
      const credit = cell(row, 'credit') === '' ? 0 : parseAmountText(cell(row, 'credit'), options.decimal);
      if (debit === null || credit === null) return fail(`Monto inválido: "${debit === null ? cell(row, 'debit') : cell(row, 'credit')}".`);
      if (debit !== 0 && credit !== 0) return fail('Tiene débito y crédito a la vez.');
      if (debit === 0 && credit === 0) return fail('No tiene monto.');
      type = debit !== 0 ? 'expense' : 'income';
      amount = Math.abs(debit !== 0 ? debit : credit);
    } else {
      const parsed = parseAmountText(cell(row, 'amount'), options.decimal);
      if (parsed === null) return fail(cell(row, 'amount') === '' ? 'No tiene monto.' : `Monto inválido: "${cell(row, 'amount')}".`);
      if (parsed < 0) sawNegative = true;
      amount = Math.abs(parsed);
      if (type === null) type = (parsed < 0) !== options.expensesArePositive ? 'expense' : 'income';
    }
    if (amount === 0) return fail('El monto es cero.');

    // fecha
    const date = parseDateText(cell(row, 'date'), dateFormat);
    if (date === null) return fail(cell(row, 'date') === '' ? 'No tiene fecha.' : `Fecha inválida: "${cell(row, 'date')}".`);

    // cuenta y moneda
    const accountName = cell(row, 'account');
    let account = defaultAccount;
    if (accountName !== '') {
      const match = accountByName.get(normalizeText(accountName));
      if (match) account = match;
      else unknownAccounts.add(accountName);
    }
    const currencyText = cell(row, 'currency');
    const fileCurrency = currencyText === '' ? null : parseCurrencyText(currencyText);
    if (fileCurrency && fileCurrency !== account.currency) {
      return fail(`La moneda del archivo (${fileCurrency}) no coincide con la de la cuenta "${account.name}" (${account.currency}).`);
    }

    const description = cell(row, 'description').replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION);
    const categoryText = cell(row, 'category');
    const category = categoryText === '' ? undefined : (resolver.resolve(categoryText, type) ?? undefined);

    const draft = { type, accountId: account.id, amount, date, description, category };
    const key = movementKey(draft);
    const already = existingCounts.get(key) ?? 0;
    if (already > 0) {
      existingCounts.set(key, already - 1);
      items.push({ line, status: 'duplicate', reason: 'Ya existe un movimiento igual.', draft });
    } else {
      items.push({ line, status: 'ok', draft });
    }
  });

  const counts = { ok: 0, duplicate: 0, error: 0, skipped: 0, expense: 0, income: 0 };
  const totals: ImportPlan['totals'] = { ARS: { expense: 0, income: 0 }, USD: { expense: 0, income: 0 } };
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  for (const item of items) {
    counts[item.status]++;
    if (item.status === 'ok' && item.draft) {
      counts[item.draft.type]++;
      totals[currencyOf.get(item.draft.accountId) ?? 'ARS'][item.draft.type] += item.draft.amount;
    }
  }

  const warnings: string[] = [];
  if (unknownAccounts.size > 0) {
    warnings.push(`Cuentas del archivo que no existen en la app (esas filas van a "${defaultAccount?.name}"): ${[...unknownAccounts].slice(0, 5).join(', ')}${unknownAccounts.size > 5 ? '…' : ''}.`);
  }
  if (mapping.type === null && mapping.amount !== null && counts.ok > 0 && !sawNegative && !options.expensesArePositive) {
    warnings.push('Todos los montos son positivos y no hay columna de tipo: se importan como ingresos. Si son gastos, marcá "En este archivo los gastos vienen en positivo".');
  }
  return { items, newCategories: resolver.created, warnings, counts, totals };
}

// ---------- Categorías ----------

function makeCategoryResolver(categories: readonly Category[], create: boolean) {
  const created: PlanCategory[] = [];
  const createdByKey = new Map<string, PlanCategory>();
  const norm = normalizeText;

  const findExisting = (name: string, kind: Category['kind'], parentId: string | undefined | 'any'): Category | undefined => {
    const matches = categories.filter((c) => c.kind === kind && norm(c.name) === norm(name) && (parentId === 'any' || (c.parentId ?? undefined) === parentId));
    // si el nombre existe como principal y como subcategoría, se prefiere la principal
    return matches.find((c) => !c.parentId) ?? matches[0];
  };

  const makeNew = (name: string, kind: Category['kind'], parent?: CategoryRef): CategoryRef => {
    const parentPart = parent ? ('id' in parent ? `id:${parent.id}` : `new:${parent.newKey}`) : '';
    const key = `${kind}|${parentPart}|${norm(name)}`;
    if (!createdByKey.has(key)) {
      const entry: PlanCategory = { key, kind, name, parent };
      createdByKey.set(key, entry);
      created.push(entry);
    }
    return { newKey: key };
  };

  return {
    created,
    /** "Comida" o "Comida > Super". Sin coincidencia: se crea (si se permite) o la fila queda sin categoría. */
    resolve(text: string, kind: Category['kind']): CategoryRef | null {
      const path = text.split('>').map((s) => s.trim()).filter(Boolean);
      if (path.length === 0) return null;
      const leaf = path[path.length - 1]!;

      if (path.length > 1) {
        const parent = findExisting(path[0]!, kind, undefined);
        if (parent) {
          const child = findExisting(leaf, kind, parent.id);
          if (child) return { id: child.id };
          return create ? makeNew(leaf, kind, { id: parent.id }) : { id: parent.id };
        }
        // sin padre: se busca la hoja sola y, si no, se crea toda la ruta
        const alone = findExisting(leaf, kind, 'any');
        if (alone) return { id: alone.id };
        if (!create) return null;
        return makeNew(leaf, kind, makeNew(path[0]!, kind));
      }

      const found = findExisting(leaf, kind, 'any');
      if (found) return { id: found.id };
      return create ? makeNew(leaf, kind) : null;
    },
  };
}

// ---------- Plantilla ----------

/** CSV de ejemplo para que el usuario arme su lista. */
export function importTemplateCSV(): string {
  const rows = [
    ['Fecha', 'Descripción', 'Monto', 'Categoría', 'Cuenta'],
    ['15/10/2026', 'Supermercado', '-12345,67', 'Supermercado', ''],
    ['16/10/2026', 'Sueldo', '800000', 'Sueldo', ''],
    ['17/10/2026', 'Nafta', '-40000', 'Combustible', ''],
  ];
  return `﻿${rows.map((r) => r.join(';')).join('\r\n')}\r\n`;
}
