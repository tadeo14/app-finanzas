// Lógica pura de cuentas y movimientos: saldos, validación, filtros y agrupado.
import { isValidDate, periodOf } from './dates';
import type { Account, Category, Currency, Transaction } from './types';

/**
 * Efecto de un movimiento sobre el saldo de una cuenta, en centavos de la moneda de esa cuenta.
 * En una transferencia entre monedas distintas, la cuenta destino recibe `toAmount`.
 */
export function signedAmountFor(tx: Transaction, accountId: string): number {
  let delta = 0;
  if (tx.accountId === accountId) {
    delta += tx.type === 'income' ? tx.amount : -tx.amount;
  }
  if (tx.type === 'transfer' && tx.toAccountId === accountId) {
    delta += tx.toAmount ?? tx.amount;
  }
  return delta;
}

/** Saldo actual = saldo inicial + efecto de todos sus movimientos. */
export function accountBalance(account: Account, transactions: readonly Transaction[]): number {
  return transactions.reduce((acc, tx) => acc + signedAmountFor(tx, account.id), account.initialBalance);
}

/** Saldo de cada cuenta, indexado por id. Recorre los movimientos una sola vez. */
export function balancesById(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Map<string, number> {
  const balances = new Map(accounts.map((a) => [a.id, a.initialBalance]));
  const add = (id: string | undefined, delta: number) => {
    if (id !== undefined && balances.has(id)) balances.set(id, balances.get(id)! + delta);
  };
  for (const tx of transactions) {
    if (tx.type === 'income') add(tx.accountId, tx.amount);
    else add(tx.accountId, -tx.amount);
    if (tx.type === 'transfer') add(tx.toAccountId, tx.toAmount ?? tx.amount);
  }
  return balances;
}

/** Total por moneda de las cuentas no archivadas. */
export function totalsByCurrency(
  accounts: readonly Account[],
  balances: ReadonlyMap<string, number>,
): Record<Currency, number> {
  const totals: Record<Currency, number> = { ARS: 0, USD: 0 };
  for (const account of accounts) {
    if (!account.archived) totals[account.currency] += balances.get(account.id) ?? 0;
  }
  return totals;
}

/** Devuelve la lista de errores de un movimiento; vacía si es válido. */
export function validateTransaction(tx: Omit<Transaction, 'id'>, accounts: readonly Account[]): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) errors.push('El monto tiene que ser mayor a cero.');
  if (!isValidDate(tx.date)) errors.push('La fecha no es válida.');

  const from = accounts.find((a) => a.id === tx.accountId);
  if (!from) errors.push('Elegí una cuenta.');

  if (tx.type === 'transfer') {
    const to = accounts.find((a) => a.id === tx.toAccountId);
    if (!to) {
      errors.push('Elegí la cuenta destino.');
    } else if (to.id === tx.accountId) {
      errors.push('La cuenta destino tiene que ser distinta de la de origen.');
    } else if (from && from.currency !== to.currency) {
      if (tx.toAmount === undefined || !Number.isSafeInteger(tx.toAmount) || tx.toAmount <= 0) {
        errors.push(`Indicá cuánto llega en ${to.currency}.`);
      }
    }
  } else if (tx.toAccountId !== undefined || tx.toAmount !== undefined) {
    errors.push('Solo las transferencias tienen cuenta destino.');
  }
  return errors;
}

export interface TransactionFilters {
  month?: string;        // 'YYYY-MM'
  accountId?: string;    // origen o destino
  categoryId?: string;   // incluye sus subcategorías
  type?: Transaction['type'];
  text?: string;
}

/** Normaliza para buscar sin importar mayúsculas ni tildes. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Ids de una categoría y todas sus subcategorías. */
export function categoryWithDescendants(categoryId: string, categories: readonly Category[]): Set<string> {
  const ids = new Set([categoryId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        added = true;
      }
    }
  }
  return ids;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  filters: TransactionFilters,
  categories: readonly Category[] = [],
): Transaction[] {
  const categoryIds = filters.categoryId ? categoryWithDescendants(filters.categoryId, categories) : null;
  const text = filters.text ? normalizeText(filters.text) : '';
  const categoryName = new Map(categories.map((c) => [c.id, normalizeText(c.name)]));

  return transactions.filter((tx) => {
    if (filters.month && periodOf(tx.date) !== filters.month) return false;
    if (filters.accountId && tx.accountId !== filters.accountId && tx.toAccountId !== filters.accountId) return false;
    if (filters.type && tx.type !== filters.type) return false;
    if (categoryIds && (!tx.categoryId || !categoryIds.has(tx.categoryId))) return false;
    if (text) {
      const haystack = `${normalizeText(tx.description)} ${tx.categoryId ? categoryName.get(tx.categoryId) ?? '' : ''}`;
      if (!haystack.includes(text)) return false;
    }
    return true;
  });
}

/** Agrupa por día, días del más reciente al más viejo. Dentro del día se respeta el orden recibido. */
export function groupByDay<T extends { date: string }>(items: readonly T[]): { date: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.date);
    if (list) list.push(item);
    else groups.set(item.date, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, items: list }));
}

/** Ingresos y gastos de un conjunto de movimientos, por moneda. Las transferencias no cuentan. */
export function incomeAndExpense(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  excludedCategoryIds: ReadonlySet<string> = new Set(),
): Record<Currency, { income: number; expense: number }> {
  const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));
  const result: Record<Currency, { income: number; expense: number }> = {
    ARS: { income: 0, expense: 0 },
    USD: { income: 0, expense: 0 },
  };
  for (const tx of transactions) {
    if (tx.type === 'transfer') continue;
    if (tx.categoryId && excludedCategoryIds.has(tx.categoryId)) continue;
    const currency = currencyOf.get(tx.accountId);
    if (!currency) continue;
    result[currency][tx.type] += tx.amount;
  }
  return result;
}
