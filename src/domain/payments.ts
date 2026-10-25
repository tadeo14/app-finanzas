// Pago de resúmenes de tarjeta (SPEC §4.8). Funciones puras.
import { addMonths, compareIso } from './dates';
import { paymentsFor, resolveStatement, totalsFor, type StatementSummary } from './cards';
import { convert, formatMoney } from './money';
import type { Account, Card, Installment, Statement, StatementPayment } from './types';

/** Lo que el usuario quiere pagar: pesos y/o dólares, y la cotización si paga dólares con pesos. */
export interface PaymentDraft {
  amountARS: number;
  amountUSD: number;
  exchangeRate?: number;
}

/** Errores de un pago; lista vacía si es válido. El tope es lo que falta pagar del resumen (con saldo anterior). */
export function validatePayment(
  draft: PaymentDraft,
  account: Pick<Account, 'currency'>,
  summary: Pick<StatementSummary, 'remainingARS' | 'remainingUSD'>,
): string[] {
  const errors: string[] = [];
  const { amountARS, amountUSD } = draft;
  if (![amountARS, amountUSD].every((n) => Number.isSafeInteger(n) && n >= 0)) {
    return ['Los montos no son válidos.'];
  }
  if (amountARS === 0 && amountUSD === 0) return ['Ingresá cuánto vas a pagar.'];

  const owedARS = Math.max(0, summary.remainingARS);
  const owedUSD = Math.max(0, summary.remainingUSD);
  if (amountARS > owedARS) errors.push(`No podés pagar más de lo que debés en pesos (${formatMoney(owedARS, 'ARS')}).`);
  if (amountUSD > owedUSD) errors.push(`No podés pagar más de lo que debés en dólares (${formatMoney(owedUSD, 'USD')}).`);

  if (account.currency === 'USD') {
    if (amountARS > 0) errors.push('Una cuenta en dólares solo puede pagar el saldo en dólares.');
  } else if (amountUSD > 0 && !(draft.exchangeRate !== undefined && draft.exchangeRate > 0)) {
    errors.push('Para pagar dólares con pesos indicá la cotización.');
  }
  return errors;
}

/** Monto que sale de la cuenta, en la moneda de la cuenta. */
export function paymentAccountAmount(draft: PaymentDraft, account: Pick<Account, 'currency'>): number {
  if (account.currency === 'USD') return draft.amountUSD;
  const usdInPesos = draft.amountUSD > 0 ? convert(draft.amountUSD, draft.exchangeRate ?? 0) : 0;
  return draft.amountARS + usdInPesos;
}

export interface PaymentChunk {
  period: string;
  amountARS: number;
  amountUSD: number;
}

/**
 * Reparte un pago entre el resumen elegido y los resúmenes anteriores ya vencidos con deuda, del
 * más viejo al más nuevo (el saldo anterior se arrastra, así que pagarlo salda esos resúmenes).
 * Cada resumen absorbe como mucho lo que le falta de sus propias compras.
 */
export function allocatePayment(
  card: Pick<Card, 'id' | 'defaultClosingDay' | 'defaultDueDay'>,
  statements: readonly Statement[],
  installments: readonly Installment[],
  payments: readonly StatementPayment[],
  period: string,
  amountARS: number,
  amountUSD: number,
  todayDate: string,
): PaymentChunk[] {
  const mine = installments.filter((i) => i.cardId === card.id);
  const earliest = [
    ...mine.map((i) => i.period),
    ...statements.filter((s) => s.cardId === card.id).map((s) => s.period),
    period,
  ].sort()[0]!;

  const periods: string[] = [];
  for (let p = earliest; p < period; p = addMonths(p, 1)) {
    if (compareIso(todayDate, resolveStatement(card, statements, p).dueDate) > 0) periods.push(p);
  }
  periods.push(period);

  let leftARS = amountARS;
  let leftUSD = amountUSD;
  const chunks: PaymentChunk[] = [];
  for (const p of periods) {
    const total = totalsFor(mine, card.id, p);
    const paid = paymentsFor(statements, payments, card.id, p);
    const chunk = {
      period: p,
      amountARS: Math.min(leftARS, Math.max(0, total.ARS - paid.ARS)),
      amountUSD: Math.min(leftUSD, Math.max(0, total.USD - paid.USD)),
    };
    leftARS -= chunk.amountARS;
    leftUSD -= chunk.amountUSD;
    if (chunk.amountARS > 0 || chunk.amountUSD > 0) chunks.push(chunk);
  }
  if (leftARS > 0 || leftUSD > 0) throw new RangeError('El pago supera lo que se debe de la tarjeta.');
  return chunks;
}

/** Períodos de la tarjeta que ya tienen algún pago (total o parcial). */
export function periodsWithPayments(
  card: Pick<Card, 'id'>,
  statements: readonly Statement[],
  payments: readonly StatementPayment[],
): Set<string> {
  const periodById = new Map(statements.filter((s) => s.cardId === card.id).map((s) => [s.id, s.period]));
  const result = new Set<string>();
  for (const p of payments) {
    const period = periodById.get(p.statementId);
    if (period && (p.amountARS > 0 || p.amountUSD > 0)) result.add(period);
  }
  return result;
}
