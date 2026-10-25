// Datos del panel de inicio. Funciones puras.
import { periodForPurchase, statementSummary } from './cards';
import { addMonths, diffDays } from './dates';
import type { Card, Currency, Installment, Statement, StatementPayment } from './types';

/** Total consolidado en pesos. Si hay dólares y no hay cotización no se puede consolidar. */
export function consolidateARS(totals: Record<Currency, number>, usdRate?: number): number | undefined {
  if (totals.USD === 0) return totals.ARS;
  if (usdRate === undefined || !(usdRate > 0)) return undefined;
  return totals.ARS + Math.round(totals.USD * usdRate);
}

export interface NextDue {
  cardId: string;
  period: string;
  dueDate: string;
  remainingARS: number;
  remainingUSD: number;
  /** Días hasta el vencimiento; negativo si ya venció. */
  daysLeft: number;
  overdue: boolean;
}

/**
 * Próximo vencimiento con saldo de una tarjeta: el resumen ya cerrado si tiene deuda, si no el que
 * está abierto. Un resumen vencido impago aparece primero, con el saldo anterior ya incluido.
 */
export function nextDue(
  card: Pick<Card, 'id' | 'defaultClosingDay' | 'defaultDueDay'>,
  statements: readonly Statement[],
  installments: readonly Installment[],
  payments: readonly StatementPayment[],
  todayDate: string,
): NextDue | null {
  const current = periodForPurchase(card, statements, todayDate);
  for (const period of [addMonths(current, -1), current, addMonths(current, 1)]) {
    const s = statementSummary(card, statements, installments, payments, period, todayDate);
    if (s.remainingARS > 0 || s.remainingUSD > 0) {
      const daysLeft = diffDays(todayDate, s.dueDate);
      return {
        cardId: card.id,
        period,
        dueDate: s.dueDate,
        remainingARS: Math.max(0, s.remainingARS),
        remainingUSD: Math.max(0, s.remainingUSD),
        daysLeft,
        overdue: daysLeft < 0,
      };
    }
  }
  return null;
}
