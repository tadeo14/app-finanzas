// Lecturas reactivas: los componentes se re-renderizan solos cuando cambia la base.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { balancesById } from '../domain/accounts';
import type { Account, Card, CardPurchase, Category, Installment, Statement, StatementPayment, Transaction } from '../domain/types';
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

/** Tarjetas ordenadas por nombre. undefined mientras carga. */
export function useCards(): Card[] | undefined {
  return useLiveQuery(() => db.cards.toArray().then(sortByName), []);
}

export function useCard(id: string | undefined): Card | undefined | null {
  return useLiveQuery(async () => (id ? (await db.cards.get(id)) ?? null : null), [id]);
}

// Las siguientes aceptan un cardId opcional; sin él devuelven los datos de todas las tarjetas.
export function useStatements(cardId?: string): Statement[] | undefined {
  return useLiveQuery(() => (cardId ? db.statements.where('cardId').equals(cardId).toArray() : db.statements.toArray()), [cardId]);
}

export function usePurchases(cardId?: string): CardPurchase[] | undefined {
  return useLiveQuery(() => (cardId ? db.cardPurchases.where('cardId').equals(cardId).toArray() : db.cardPurchases.toArray()), [cardId]);
}

export function useInstallments(cardId?: string): Installment[] | undefined {
  return useLiveQuery(() => (cardId ? db.installments.where('cardId').equals(cardId).toArray() : db.installments.toArray()), [cardId]);
}

export function usePayments(): StatementPayment[] | undefined {
  return useLiveQuery(() => db.statementPayments.toArray(), []);
}

export function usePurchase(id: string | undefined): CardPurchase | undefined | null {
  return useLiveQuery(async () => (id ? (await db.cardPurchases.get(id)) ?? null : null), [id]);
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
