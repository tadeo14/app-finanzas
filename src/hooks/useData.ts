// Lecturas reactivas: los componentes se re-renderizan solos cuando cambia la base.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { balancesById } from '../domain/accounts';
import type { Account, Category, Transaction } from '../domain/types';
import { db } from '../db/schema';

const NONE: never[] = [];

/** Cuentas ordenadas por nombre. undefined mientras carga. */
export function useAccounts(): Account[] | undefined {
  return useLiveQuery(() => db.accounts.toArray().then(sortByName), []);
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.toArray().then(sortByName), []) ?? NONE;
}

/** Todos los movimientos de cuentas, más nuevos primero. undefined mientras carga. */
export function useTransactions(): Transaction[] | undefined {
  return useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), []);
}

export function useTransaction(id: string | undefined): Transaction | undefined | null {
  return useLiveQuery(async () => (id ? (await db.transactions.get(id)) ?? null : null), [id]);
}

export function useBalances(
  accounts: Account[] | undefined,
  transactions: Transaction[] | undefined,
): Map<string, number> {
  return useMemo(() => balancesById(accounts ?? NONE, transactions ?? NONE), [accounts, transactions]);
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
