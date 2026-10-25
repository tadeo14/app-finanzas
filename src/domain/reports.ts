// Reportes y presupuestos (SPEC §4.9, §5.5). Funciones puras.
// Los gastos con tarjeta se imputan al mes del resumen (período) donde cae cada cuota; los de cuenta, por fecha.
import { addMonths, periodOf } from './dates';
import type { Account, Budget, Category, Currency, Installment, Transaction } from './types';

export interface Entry {
  categoryId?: string;
  /** Centavos en la moneda de `currency`; negativo en devoluciones. */
  amount: number;
  currency: Currency;
}

export interface ReportSources {
  transactions: readonly Transaction[];
  installments: readonly Installment[];
  accounts: readonly Account[];
  /** Categorías que no son gasto ni ingreso real (el pago de tarjeta: el gasto ya se contó en las cuotas). */
  excludedCategoryIds?: ReadonlySet<string>;
}

/** Ingresos y gastos de un mes. Las transferencias no cuentan. */
export function entriesForMonth(src: ReportSources, month: string): { income: Entry[]; expense: Entry[] } {
  const currencyOf = new Map(src.accounts.map((a) => [a.id, a.currency]));
  const income: Entry[] = [];
  const expense: Entry[] = [];

  for (const tx of src.transactions) {
    if (tx.type === 'transfer' || periodOf(tx.date) !== month) continue;
    if (tx.categoryId && src.excludedCategoryIds?.has(tx.categoryId)) continue;
    const currency = currencyOf.get(tx.accountId);
    if (!currency) continue;
    (tx.type === 'income' ? income : expense).push({ categoryId: tx.categoryId, amount: tx.amount, currency });
  }
  for (const i of src.installments) {
    if (i.status === 'scheduled' && i.period === month) {
      expense.push({ categoryId: i.categoryId, amount: i.amount, currency: i.currency });
    }
  }
  return { income, expense };
}

/** Pesos de un monto; los dólares solo se convierten si hay cotización de referencia. */
export function toARS(entry: Pick<Entry, 'amount' | 'currency'>, usdRate?: number): number | null {
  if (entry.currency === 'ARS') return entry.amount;
  return usdRate !== undefined && usdRate > 0 ? Math.round(entry.amount * usdRate) : null;
}

export function sumARS(entries: readonly Entry[], usdRate?: number): { total: number; skippedUSD: boolean } {
  let total = 0;
  let skippedUSD = false;
  for (const e of entries) {
    const ars = toARS(e, usdRate);
    if (ars === null) skippedUSD = true;
    else total += ars;
  }
  return { total, skippedUSD };
}

/** Cadena desde la categoría hasta su raíz, p. ej. [Supermercado, Comida]. Tolera ciclos. */
function chainOf(categoryId: string, byId: ReadonlyMap<string, Category>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = categoryId;
  while (current !== undefined && !seen.has(current) && byId.has(current)) {
    seen.add(current);
    chain.push(current);
    current = byId.get(current)!.parentId;
  }
  return chain;
}

export const NO_CATEGORY = 'none';

export interface CategoryRow {
  /** Categoría raíz (o NO_CATEGORY). */
  categoryId: string;
  /** Total de la raíz con sus subcategorías. */
  amount: number;
  /** Lo cargado directo en la raíz, sin subcategoría. */
  own: number;
  children: { categoryId: string; amount: number }[];
}

/** Gastos por categoría raíz, con el detalle por subcategoría (drill-down). Mayores primero. */
export function expensesByCategory(
  entries: readonly Entry[],
  categories: readonly Category[],
  usdRate?: number,
): { rows: CategoryRow[]; total: number; skippedUSD: boolean } {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rows = new Map<string, { own: number; children: Map<string, number> }>();
  let total = 0;
  let skippedUSD = false;

  for (const entry of entries) {
    const ars = toARS(entry, usdRate);
    if (ars === null) {
      skippedUSD = true;
      continue;
    }
    total += ars;
    const chain = entry.categoryId ? chainOf(entry.categoryId, byId) : [];
    const root = chain.length ? chain[chain.length - 1]! : NO_CATEGORY;
    const row = rows.get(root) ?? { own: 0, children: new Map<string, number>() };
    rows.set(root, row);
    if (chain.length <= 1) row.own += ars;
    else {
      // el hijo directo de la raíz absorbe a los niveles más profundos
      const child = chain[chain.length - 2]!;
      row.children.set(child, (row.children.get(child) ?? 0) + ars);
    }
  }

  const result: CategoryRow[] = [...rows.entries()].map(([categoryId, r]) => {
    const children = [...r.children.entries()].map(([id, amount]) => ({ categoryId: id, amount })).sort((a, b) => b.amount - a.amount);
    return { categoryId, own: r.own, children, amount: r.own + children.reduce((s, c) => s + c.amount, 0) };
  });
  result.sort((a, b) => b.amount - a.amount);
  return { rows: result, total, skippedUSD };
}

/** Para una torta legible: hasta `maxSlices` segmentos; el resto se junta en "Otros". */
export function sliceRows<T extends { amount: number }>(
  rows: readonly T[],
  maxSlices = 6,
): { items: T[]; othersAmount: number; othersCount: number } {
  const positive = rows.filter((r) => r.amount > 0);
  if (positive.length <= maxSlices) return { items: positive, othersAmount: 0, othersCount: 0 };
  const rest = positive.slice(maxSlices - 1);
  return {
    items: positive.slice(0, maxSlices - 1),
    othersAmount: rest.reduce((s, r) => s + r.amount, 0),
    othersCount: rest.length,
  };
}

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
  /** Mes futuro: solo tiene las cuotas ya programadas. */
  projected: boolean;
}

/** Ingresos vs gastos mes a mes: `count` meses hasta `endMonth` y, opcionalmente, los meses futuros con cuotas. */
export function monthlySeries(
  src: ReportSources,
  endMonth: string,
  usdRate: number | undefined,
  count = 12,
  futureMonths = 0,
): { points: MonthPoint[]; skippedUSD: boolean } {
  const points: MonthPoint[] = [];
  let skippedUSD = false;
  for (let i = -(count - 1); i <= futureMonths; i++) {
    const month = addMonths(endMonth, i);
    const { income, expense } = entriesForMonth(src, month);
    const inc = sumARS(income, usdRate);
    const exp = sumARS(expense, usdRate);
    skippedUSD ||= inc.skippedUSD || exp.skippedUSD;
    points.push({ month, income: inc.total, expense: exp.total, projected: i > 0 });
  }
  return { points, skippedUSD };
}

// ---------- Presupuestos ----------

export type BudgetLevel = 'ok' | 'warning' | 'over';

/** Alerta al 80% y al 100% (SPEC §5.1). */
export function budgetLevel(ratio: number): BudgetLevel {
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warning';
  return 'ok';
}

/** El presupuesto de un mes pisa al "default" (el que se repite todos los meses). */
export function effectiveBudget(categoryId: string, month: string, budgets: readonly Budget[]): Budget | undefined {
  const mine = budgets.filter((b) => b.categoryId === categoryId);
  return mine.find((b) => b.month === month) ?? mine.find((b) => b.month === 'default');
}

/** Gasto de cada categoría incluyendo a sus subcategorías: cada gasto suma en su categoría y en todas sus ancestras. */
export function spentByCategory(
  entries: readonly Entry[],
  categories: readonly Category[],
  usdRate?: number,
): Map<string, number> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const spent = new Map<string, number>();
  for (const entry of entries) {
    const ars = toARS(entry, usdRate);
    if (ars === null || !entry.categoryId) continue;
    for (const id of chainOf(entry.categoryId, byId)) spent.set(id, (spent.get(id) ?? 0) + ars);
  }
  return spent;
}

export interface BudgetProgress {
  categoryId: string;
  budget: number;
  spent: number;
  ratio: number;
  level: BudgetLevel;
}

/** Avance de cada presupuesto vigente en el mes, el más comprometido primero. */
export function budgetProgress(
  month: string,
  budgets: readonly Budget[],
  categories: readonly Category[],
  expenseEntries: readonly Entry[],
  usdRate?: number,
): BudgetProgress[] {
  const spent = spentByCategory(expenseEntries, categories, usdRate);
  const result: BudgetProgress[] = [];
  for (const categoryId of new Set(budgets.map((b) => b.categoryId))) {
    const budget = effectiveBudget(categoryId, month, budgets);
    if (!budget || budget.amount <= 0) continue;
    const s = spent.get(categoryId) ?? 0;
    const ratio = s / budget.amount;
    result.push({ categoryId, budget: budget.amount, spent: s, ratio, level: budgetLevel(ratio) });
  }
  return result.sort((a, b) => b.ratio - a.ratio);
}
