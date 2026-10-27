// Formato del backup, su validación y el recordatorio (SPEC §5.6). Funciones puras.
// Importar reemplaza todo, así que el archivo se valida por completo ANTES de borrar nada.
import { diffDays, isValidDate } from './dates';
import type { Settings } from './types';

export const BACKUP_APP = 'finanzas-personales';
/** Versión del formato del archivo (distinta de la versión del esquema de la base). */
export const BACKUP_FORMAT = 1;

export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'cards',
  'statements',
  'cardPurchases',
  'installments',
  'statementPayments',
  'budgets',
  'recurrings',
  'settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  exportedAt: string;
  data: Record<BackupTable, Record<string, unknown>[]>;
}

type Row = Record<string, unknown>;

const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isDate = (v: unknown): v is string => typeof v === 'string' && isValidDate(v);
const isPeriod = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const oneOf = (...values: string[]) => (v: unknown): boolean => typeof v === 'string' && values.includes(v);
const optional = (check: (v: unknown) => boolean) => (v: unknown) => v === undefined || check(v);
const int = (min: number, max = Number.MAX_SAFE_INTEGER) => (v: unknown) => isInt(v) && v >= min && v <= max;

type Check = (value: unknown) => boolean;
const currency = oneOf('ARS', 'USD');

/** Reglas por campo de cada tabla: lo mínimo para que la app no se rompa con un archivo mal armado. */
const RULES: Record<BackupTable, Record<string, Check>> = {
  accounts: { name: isStr, type: oneOf('bank', 'cash', 'wallet', 'investment'), currency, initialBalance: isInt, archived: isBool },
  categories: { name: isStr, kind: oneOf('expense', 'income'), parentId: optional(isStr) },
  transactions: {
    type: oneOf('expense', 'income', 'transfer'), accountId: isStr, amount: int(1), date: isDate,
    toAccountId: optional(isStr), toAmount: optional(int(1)), categoryId: optional(isStr), statementPaymentId: optional(isStr),
    importId: optional(isStr),
  },
  cards: { name: isStr, defaultClosingDay: int(1, 31), defaultDueDay: int(1, 31), archived: isBool, limit: optional(int(1)) },
  statements: { cardId: isStr, period: isPeriod, closingDate: isDate, dueDate: isDate },
  cardPurchases: {
    cardId: isStr, date: isDate, categoryId: isStr, currency, installments: int(1, 120), amountMode: oneOf('total', 'perInstallment'),
    totalAmount: isInt, startInstallment: int(1), isRefund: isBool,
  },
  installments: {
    purchaseId: isStr, cardId: isStr, number: int(1), of: int(1), period: isPeriod, amount: isInt, currency, categoryId: isStr,
    status: oneOf('scheduled', 'cancelled'),
  },
  statementPayments: { statementId: isStr, accountId: isStr, date: isDate, amountARS: int(0), amountUSD: int(0) },
  budgets: { categoryId: isStr, month: (v) => v === 'default' || isPeriod(v), amount: isInt },
  recurrings: {
    kind: oneOf('transaction', 'cardPurchase'), template: isObject, frequency: oneOf('monthly', 'weekly', 'yearly'), startDate: isDate,
    dayOfMonth: optional(int(1, 31)), endDate: optional(isDate), lastGenerated: optional(isDate),
  },
  settings: {
    firstDayOfWeek: (v) => v === 0 || v === 1,
    usdRate: optional((v) => typeof v === 'number' && Number.isFinite(v) && v > 0),
    lastBackupAt: optional(isDate), installedAt: optional(isDate), theme: optional(oneOf('system', 'light', 'dark')),
  },
};

const MAX_ERRORS = 15;

export type BackupValidation = { ok: true; backup: BackupFile } | { ok: false; errors: string[] };

export function validateBackup(raw: unknown): BackupValidation {
  if (!isObject(raw) || raw.app !== BACKUP_APP) {
    return { ok: false, errors: ['Este archivo no es un backup de Finanzas Personales.'] };
  }
  if (!isInt(raw.format) || raw.format < 1) return { ok: false, errors: ['El archivo no indica su versión.'] };
  if (raw.format > BACKUP_FORMAT) {
    return { ok: false, errors: ['Este backup se creó con una versión más nueva de la app. Actualizá la app e intentá de nuevo.'] };
  }
  if (!isObject(raw.data)) return { ok: false, errors: ['El archivo no tiene datos.'] };

  const errors: string[] = [];
  const fail = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message);
  };
  const tables = {} as Record<BackupTable, Row[]>;

  for (const table of BACKUP_TABLES) {
    const rows = (raw.data as Row)[table];
    if (!Array.isArray(rows)) {
      fail(`Falta la tabla "${table}".`);
      tables[table] = [];
      continue;
    }
    const ids = new Set<string>();
    rows.forEach((row, index) => {
      const where = `${table} #${index + 1}`;
      if (!isObject(row) || !isStr(row.id)) return fail(`${where}: no tiene id.`);
      if (ids.has(row.id)) fail(`${where}: id repetido.`);
      ids.add(row.id);
      for (const [field, check] of Object.entries(RULES[table])) {
        if (!check(row[field])) fail(`${where}: el campo "${field}" no es válido.`);
      }
    });
    tables[table] = rows.filter(isObject);
  }
  if (errors.length === 0 && tables.settings.some((s) => s.id !== 'app')) fail('settings: el id tiene que ser "app".');

  if (errors.length === 0) checkReferences(tables, fail);
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, backup: { app: BACKUP_APP, format: raw.format, exportedAt: String(raw.exportedAt ?? ''), data: tables } };
}

/** Integridad referencial y unicidad de los índices únicos, para dar un error claro y no uno de la base. */
function checkReferences(t: Record<BackupTable, Row[]>, fail: (message: string) => void): void {
  const ids = (table: BackupTable) => new Set(t[table].map((r) => r.id as string));
  const accounts = ids('accounts');
  const categories = ids('categories');
  const cards = ids('cards');
  const statements = ids('statements');
  const purchases = ids('cardPurchases');
  const payments = ids('statementPayments');

  const needs = (table: BackupTable, field: string, target: Set<string>, targetName: string) => {
    t[table].forEach((row, i) => {
      const value = row[field];
      if (value !== undefined && !target.has(value as string)) fail(`${table} #${i + 1}: ${field} apunta a ${targetName} que no existe.`);
    });
  };
  needs('transactions', 'accountId', accounts, 'una cuenta');
  needs('transactions', 'toAccountId', accounts, 'una cuenta');
  needs('transactions', 'statementPaymentId', payments, 'un pago');
  needs('statements', 'cardId', cards, 'una tarjeta');
  needs('cardPurchases', 'cardId', cards, 'una tarjeta');
  needs('installments', 'cardId', cards, 'una tarjeta');
  needs('installments', 'purchaseId', purchases, 'una compra');
  needs('statementPayments', 'statementId', statements, 'un resumen');
  needs('statementPayments', 'accountId', accounts, 'una cuenta');
  needs('budgets', 'categoryId', categories, 'una categoría');

  const unique = (table: BackupTable, a: string, b: string) => {
    const seen = new Set<string>();
    t[table].forEach((row, i) => {
      const key = `${row[a]}|${row[b]}`;
      if (seen.has(key)) fail(`${table} #${i + 1}: repetido (${a} + ${b}).`);
      seen.add(key);
    });
  };
  unique('statements', 'cardId', 'period');
  unique('budgets', 'categoryId', 'month');
}

export function countRows(backup: BackupFile): Record<BackupTable, number> {
  return Object.fromEntries(BACKUP_TABLES.map((table) => [table, backup.data[table].length])) as Record<BackupTable, number>;
}

// ---------- Recordatorio ----------

export const BACKUP_REMINDER_DAYS = 15;

/**
 * Avisa si pasaron más de 15 días desde el último export (o, si nunca se exportó, desde que se empezó
 * a usar la app). Sin datos no hay nada que respaldar.
 */
export function backupReminder(
  settings: Pick<Settings, 'lastBackupAt' | 'installedAt'> | undefined,
  todayDate: string,
  hasData: boolean,
): { due: boolean; days: number | null; neverExported: boolean } {
  const neverExported = !settings?.lastBackupAt;
  const baseline = settings?.lastBackupAt ?? settings?.installedAt;
  const days = baseline ? diffDays(baseline, todayDate) : null;
  return { due: hasData && days !== null && days > BACKUP_REMINDER_DAYS, days, neverExported };
}
