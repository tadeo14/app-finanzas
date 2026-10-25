// Lista unificada de movimientos: los de cuentas y las cuotas de tarjeta del mes.
import { categoryWithDescendants, filterTransactions, normalizeText } from './accounts';
import { resolveStatement } from './cards';
import type { Card, CardPurchase, Category, Installment, Statement, Transaction } from './types';

export interface MovementFilters {
  month?: string;
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  /** 'card' = solo cuotas de tarjeta. */
  type?: Transaction['type'] | 'card';
  text?: string;
}

export type MovementRow =
  | { kind: 'transaction'; id: string; date: string; transaction: Transaction }
  | { kind: 'installment'; id: string; date: string; installment: Installment; purchase?: CardPurchase; card?: Card };

/**
 * Las cuotas aparecen en el mes del resumen (período), con la fecha de vencimiento de ese resumen.
 * Los filtros por cuenta o tipo ingreso/transferencia las ocultan; el filtro por tarjeta oculta
 * los movimientos de cuentas.
 */
export function buildMovementRows(
  data: {
    transactions: readonly Transaction[];
    installments: readonly Installment[];
    purchases: readonly CardPurchase[];
    cards: readonly Card[];
    statements: readonly Statement[];
    categories: readonly Category[];
  },
  filters: MovementFilters,
): MovementRow[] {
  const { categories } = data;
  const rows: MovementRow[] = [];

  if (!filters.cardId && filters.type !== 'card') {
    const txFilters = {
      month: filters.month,
      accountId: filters.accountId,
      categoryId: filters.categoryId,
      type: filters.type,
      text: filters.text,
    };
    for (const transaction of filterTransactions(data.transactions, txFilters, categories)) {
      rows.push({ kind: 'transaction', id: transaction.id, date: transaction.date, transaction });
    }
  }

  const showInstallments = !filters.accountId && (filters.type === undefined || filters.type === 'expense' || filters.type === 'card');
  if (showInstallments) {
    const categoryIds = filters.categoryId ? categoryWithDescendants(filters.categoryId, categories) : null;
    const text = filters.text ? normalizeText(filters.text) : '';
    const cardById = new Map(data.cards.map((c) => [c.id, c]));
    const purchaseById = new Map(data.purchases.map((p) => [p.id, p]));
    const categoryName = new Map(categories.map((c) => [c.id, normalizeText(c.name)]));

    for (const installment of data.installments) {
      if (installment.status !== 'scheduled') continue;
      if (filters.month && installment.period !== filters.month) continue;
      if (filters.cardId && installment.cardId !== filters.cardId) continue;
      if (categoryIds && !categoryIds.has(installment.categoryId)) continue;
      const card = cardById.get(installment.cardId);
      const purchase = purchaseById.get(installment.purchaseId);
      if (text) {
        const haystack = `${normalizeText(purchase?.description ?? '')} ${categoryName.get(installment.categoryId) ?? ''} ${normalizeText(card?.name ?? '')}`;
        if (!haystack.includes(text)) continue;
      }
      const date = card
        ? resolveStatement(card, data.statements, installment.period).dueDate
        : `${installment.period}-01`;
      rows.push({ kind: 'installment', id: installment.id, date, installment, purchase, card });
    }
  }
  return rows;
}
