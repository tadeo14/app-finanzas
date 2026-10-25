// Gastos e ingresos fijos y suscripciones (SPEC §6). Funciones puras.
import { addDays, addMonths, compareIso, dateInPeriod, isValidDate, parseDate, periodOf, toPeriod } from './dates';
import type { CardPurchase, Recurring, Transaction } from './types';

type Schedule = Pick<Recurring, 'frequency' | 'startDate' | 'dayOfMonth'>;

/**
 * Fechas de ocurrencia en orden, sin fin (el que consume corta). Mensual: el día elegido de cada mes
 * (o el del inicio), recortado al último día si no existe. Semanal: cada 7 días. Anual: mismo día y mes.
 */
function* candidateDates(r: Schedule): Generator<string> {
  const start = parseDate(r.startDate);
  if (r.frequency === 'weekly') {
    for (let date = r.startDate; ; date = addDays(date, 7)) yield date;
  } else if (r.frequency === 'yearly') {
    for (let year = start.year; ; year++) {
      const date = dateInPeriod(toPeriod(year, start.month), start.day);
      if (compareIso(date, r.startDate) >= 0) yield date;
    }
  } else {
    const day = r.dayOfMonth ?? start.day;
    for (let period = periodOf(r.startDate); ; period = addMonths(period, 1)) {
      const date = dateInPeriod(period, day);
      if (compareIso(date, r.startDate) >= 0) yield date;
    }
  }
}

/**
 * Ocurrencias que faltan generar: desde la siguiente a `lastGenerated` (o desde el inicio) hasta hoy
 * inclusive y sin pasar `endDate`. El tope evita generar miles de movimientos por un inicio muy viejo.
 */
export function occurrencesDue(r: Recurring | Omit<Recurring, 'id'>, todayDate: string, limit = 1000): string[] {
  const due: string[] = [];
  for (const date of candidateDates(r)) {
    if (compareIso(date, todayDate) > 0) break;
    if (r.endDate && compareIso(date, r.endDate) > 0) break;
    if (r.lastGenerated && compareIso(date, r.lastGenerated) <= 0) continue;
    due.push(date);
    if (due.length >= limit) break;
  }
  return due;
}

/** Próxima ocurrencia posterior a hoy, o null si ya terminó. */
export function nextOccurrence(r: Recurring | Omit<Recurring, 'id'>, todayDate: string): string | null {
  for (const date of candidateDates(r)) {
    if (r.endDate && compareIso(date, r.endDate) > 0) return null;
    if (compareIso(date, todayDate) > 0) return date;
  }
  return null;
}

/** Errores de un recurrente; lista vacía si es válido. */
export function validateRecurring(r: Omit<Recurring, 'id'>): string[] {
  const errors: string[] = [];
  if (!isValidDate(r.startDate)) errors.push('La fecha de inicio no es válida.');
  else if (r.endDate !== undefined && (!isValidDate(r.endDate) || compareIso(r.endDate, r.startDate) < 0)) {
    errors.push('La fecha de fin tiene que ser igual o posterior al inicio.');
  }
  if (!['monthly', 'weekly', 'yearly'].includes(r.frequency)) errors.push('Elegí la frecuencia.');
  if (r.dayOfMonth !== undefined && (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31)) {
    errors.push('El día del mes tiene que estar entre 1 y 31.');
  }

  if (r.kind === 'transaction') {
    const t = r.template as Partial<Transaction>;
    if (t.type !== 'expense' && t.type !== 'income') errors.push('Elegí si es un gasto o un ingreso.');
    if (!t.accountId) errors.push('Elegí la cuenta.');
    if (!Number.isSafeInteger(t.amount) || (t.amount ?? 0) <= 0) errors.push('El monto tiene que ser mayor a cero.');
  } else {
    const t = r.template as Partial<CardPurchase>;
    if (!t.cardId) errors.push('Elegí la tarjeta.');
    if (!t.categoryId) errors.push('Elegí una categoría.');
    if (!Number.isSafeInteger(t.totalAmount) || (t.totalAmount ?? 0) <= 0) errors.push('El monto tiene que ser mayor a cero.');
  }
  return errors;
}

/** Movimiento de cuenta para una ocurrencia. */
export function transactionFor(r: Recurring, date: string, id: string): Transaction {
  return { description: '', ...(r.template as Partial<Transaction>), id, date, recurringId: r.id } as Transaction;
}

/** Compra con tarjeta de 1 cuota para una ocurrencia (las suscripciones pagadas con tarjeta, SPEC §6). */
export function purchaseFor(r: Recurring, date: string, id: string): CardPurchase {
  const t = r.template as Partial<CardPurchase>;
  return {
    description: '',
    currency: 'ARS',
    ...t,
    id,
    date,
    installments: 1,
    amountMode: 'total',
    startInstallment: 1,
    isRefund: false,
    recurringId: r.id,
  } as CardPurchase;
}
