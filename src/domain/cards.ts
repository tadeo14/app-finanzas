// Lógica de tarjetas y cuotas (SPEC §4). Funciones puras: sin React ni Dexie.
import { addMonths, compareIso, dateInPeriod, formatPeriod, isValidDate, monthsBetween, periodOf } from './dates';
import { formatMoneyShort, splitEvenly } from './money';
import type { Card, CardPurchase, Installment, Statement, StatementPayment } from './types';

type CardDefaults = Pick<Card, 'defaultClosingDay' | 'defaultDueDay'>;
type NewId = () => string;
const randomId: NewId = () => crypto.randomUUID();

/** Resumen con sus fechas resueltas. `id` existe solo si el resumen ya se guardó (editado o con pagos). */
export interface ResolvedStatement {
  id?: string;
  cardId: string;
  period: string;
  closingDate: string;
  dueDate: string;
}

// ---------- 4.1 Fechas de cierre y vencimiento ----------

/**
 * Fechas por defecto del resumen del período `period` (mes del vencimiento).
 * Si el día de cierre es mayor al de vencimiento, el cierre cae en el mes anterior.
 * Los días que no existen en el mes (31 en febrero) se recortan al último día.
 */
export function defaultStatementDates(
  card: CardDefaults,
  period: string,
): { closingDate: string; dueDate: string } {
  const closingPeriod = card.defaultClosingDay > card.defaultDueDay ? addMonths(period, -1) : period;
  return {
    closingDate: dateInPeriod(closingPeriod, card.defaultClosingDay),
    dueDate: dateInPeriod(period, card.defaultDueDay),
  };
}

/** El resumen guardado manda sobre el default (los bancos mueven el cierre mes a mes). */
export function resolveStatement(
  card: Pick<Card, 'id'> & CardDefaults,
  statements: readonly Statement[],
  period: string,
): ResolvedStatement {
  const saved = statements.find((s) => s.cardId === card.id && s.period === period);
  if (saved) return { ...saved };
  return { cardId: card.id, period, ...defaultStatementDates(card, period) };
}

// ---------- 4.2 ¿En qué resumen cae una compra? ----------

/**
 * Una compra cae en el primer resumen cuyo cierre es >= a la fecha de compra: cada resumen incluye
 * desde el día siguiente al cierre anterior hasta su propio cierre, inclusive.
 */
export function periodForPurchase(
  card: Pick<Card, 'id'> & CardDefaults,
  statements: readonly Statement[],
  purchaseDate: string,
  firstPeriodOverride?: string,
): string {
  if (firstPeriodOverride) return firstPeriodOverride;
  // El cierre de un resumen cae en su mes o en el anterior, así que el candidato más temprano
  // posible es el mes anterior a la compra (con margen por cierres editados a mano).
  let period = addMonths(periodOf(purchaseDate), -1);
  for (let i = 0; i < 36; i++) {
    if (compareIso(resolveStatement(card, statements, period).closingDate, purchaseDate) >= 0) return period;
    period = addMonths(period, 1);
  }
  throw new RangeError(`No se encontró un resumen para la compra del ${purchaseDate}`);
}

// ---------- 4.3 Generación de cuotas ----------

/** Errores de una compra con tarjeta; lista vacía si es válida. */
export function validatePurchase(
  p: Pick<CardPurchase, 'date' | 'installments' | 'amountMode' | 'totalAmount' | 'installmentAmount' | 'startInstallment' | 'categoryId' | 'firstPeriodOverride'>,
): string[] {
  const errors: string[] = [];
  if (!isValidDate(p.date)) errors.push('La fecha no es válida.');
  if (!p.categoryId) errors.push('Elegí una categoría.');
  if (!Number.isInteger(p.installments) || p.installments < 1 || p.installments > 120) {
    errors.push('La cantidad de cuotas tiene que estar entre 1 y 120.');
  } else if (!Number.isInteger(p.startInstallment) || p.startInstallment < 1 || p.startInstallment > p.installments) {
    errors.push('La cuota inicial tiene que estar entre 1 y la cantidad de cuotas.');
  }
  const amount = p.amountMode === 'perInstallment' ? p.installmentAmount : p.totalAmount;
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) errors.push('El monto tiene que ser mayor a cero.');
  if (p.firstPeriodOverride !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.firstPeriodOverride)) {
    errors.push('El resumen elegido no es válido.');
  }
  return errors;
}

/** En modo "por cuota" el total es cuota × cantidad (SPEC §4.3). */
export function normalizePurchase(p: CardPurchase): CardPurchase {
  if (p.amountMode === 'perInstallment' && p.installmentAmount !== undefined) {
    return { ...p, totalAmount: p.installmentAmount * p.installments };
  }
  const { installmentAmount: _unused, ...rest } = p;
  return rest;
}

/**
 * Cuotas `startInstallment..installments`: la `startInstallment` cae en `firstPeriod` y cada
 * siguiente un mes después. En modo total el resto del redondeo va a la cuota 1 (si esa cuota
 * ya se pagó antes de cargar la compra, no se genera y las demás quedan en el piso).
 */
export function generateInstallments(
  purchase: CardPurchase,
  firstPeriod: string,
  newId: NewId = randomId,
): Installment[] {
  const p = normalizePurchase(purchase);
  const n = p.installments;
  const base =
    p.amountMode === 'perInstallment'
      ? Array.from({ length: n }, () => p.installmentAmount ?? 0)
      : splitEvenly(p.totalAmount, n);
  const sign = p.isRefund ? -1 : 1;

  const result: Installment[] = [];
  for (let number = p.startInstallment; number <= n; number++) {
    result.push({
      id: newId(),
      purchaseId: p.id,
      cardId: p.cardId,
      number,
      of: n,
      period: addMonths(firstPeriod, number - p.startInstallment),
      amount: base[number - 1]! * sign,
      currency: p.currency,
      categoryId: p.categoryId,
      status: 'scheduled',
    });
  }
  return result;
}

/** Texto y datos del preview en vivo de la carga rápida. */
export interface PurchasePreview {
  count: number;
  regularAmount: number;
  firstAmount: number;
  firstPeriod: string;
  lastPeriod: string;
  text: string;
}

export function previewPurchase(
  purchase: CardPurchase,
  card: Pick<Card, 'id'> & CardDefaults,
  statements: readonly Statement[],
): PurchasePreview {
  const firstPeriod = periodForPurchase(card, statements, purchase.date, purchase.firstPeriodOverride);
  const items = generateInstallments(purchase, firstPeriod, () => 'preview');
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const regular = items.length > 1 ? items[1]!.amount : first.amount;
  const money = (cents: number) => formatMoneyShort(Math.abs(cents), purchase.currency);
  const sign = purchase.isRefund ? 'devolución de ' : '';

  let text: string;
  if (items.length === 1) {
    text = `${sign}1 pago de ${money(first.amount)} en el resumen de ${formatPeriod(firstPeriod)}`;
  } else {
    const amounts =
      first.amount === regular
        ? `${items.length} cuotas de ${money(regular)}`
        : `${items.length} cuotas de ${money(regular)} (la primera de ${money(first.amount)})`;
    text = `${sign}${amounts} — primera en resumen de ${formatPeriod(firstPeriod)}, última en ${formatPeriod(last.period)}`;
  }
  return { count: items.length, regularAmount: regular, firstAmount: first.amount, firstPeriod, lastPeriod: last.period, text };
}

// ---------- 4.4 Adelantar cuotas y reasignar al editar fechas ----------

/**
 * Adelanta las cuotas restantes de una compra: las programadas después de `targetPeriod` se
 * cancelan y se crea una sola cuota por la suma en `targetPeriod`. La cuota nueva conserva el
 * número de la última cancelada, así se lee como el cierre de la compra.
 */
export function advanceInstallments(
  purchaseInstallments: readonly Installment[],
  targetPeriod: string,
  newId: NewId = randomId,
): { cancelledIds: string[]; merged: Installment } {
  const future = purchaseInstallments
    .filter((i) => i.status === 'scheduled' && i.period > targetPeriod)
    .sort((a, b) => a.number - b.number);
  if (future.length === 0) throw new RangeError('No hay cuotas posteriores a ese resumen para adelantar.');

  const last = future[future.length - 1]!;
  return {
    cancelledIds: future.map((i) => i.id),
    merged: {
      id: newId(),
      purchaseId: last.purchaseId,
      cardId: last.cardId,
      number: last.number,
      of: last.of,
      period: targetPeriod,
      amount: future.reduce((sum, i) => sum + i.amount, 0),
      currency: last.currency,
      categoryId: last.categoryId,
      status: 'scheduled',
    },
  };
}

/**
 * Al editar fechas de un resumen, las compras que ya no caen donde estaban se corren la misma
 * cantidad de meses (todas sus cuotas juntas). Se ignoran las compras con primer resumen forzado
 * y las que tienen cuotas adelantadas, para no desarmar decisiones del usuario.
 */
export function reassignPurchases(
  card: Pick<Card, 'id'> & CardDefaults,
  statements: readonly Statement[],
  purchases: readonly CardPurchase[],
  installments: readonly Installment[],
): { installmentId: string; period: string }[] {
  const updates: { installmentId: string; period: string }[] = [];
  for (const purchase of purchases) {
    if (purchase.cardId !== card.id || purchase.firstPeriodOverride) continue;
    const own = installments.filter((i) => i.purchaseId === purchase.id);
    if (own.some((i) => i.status === 'cancelled')) continue;
    const anchor = own.find((i) => i.number === purchase.startInstallment);
    if (!anchor) continue;
    const delta = monthsBetween(anchor.period, periodForPurchase(card, statements, purchase.date));
    if (delta === 0) continue;
    for (const i of own) updates.push({ installmentId: i.id, period: addMonths(i.period, delta) });
  }
  return updates;
}

// ---------- 4.5 Totales del resumen ----------

export type StatementStatus = 'open' | 'closed' | 'paid' | 'partial' | 'overdue';

export interface StatementSummary extends ResolvedStatement {
  totalARS: number;
  totalUSD: number;
  /** Saldo impago del resumen anterior; se arrastra y se muestra como línea aparte. */
  previousBalanceARS: number;
  previousBalanceUSD: number;
  paidARS: number;
  paidUSD: number;
  /** total + saldo anterior − pagos. */
  remainingARS: number;
  remainingUSD: number;
  status: StatementStatus;
}

interface Totals {
  ARS: number;
  USD: number;
}

export function totalsFor(items: readonly Installment[], cardId: string, period: string): Totals {
  const totals: Totals = { ARS: 0, USD: 0 };
  for (const i of items) {
    if (i.cardId === cardId && i.period === period && i.status === 'scheduled') totals[i.currency] += i.amount;
  }
  return totals;
}

export function paymentsFor(
  statements: readonly Statement[],
  payments: readonly StatementPayment[],
  cardId: string,
  period: string,
): { ARS: number; USD: number } {
  const statementIds = new Set(statements.filter((s) => s.cardId === cardId && s.period === period).map((s) => s.id));
  const paid = { ARS: 0, USD: 0 };
  for (const p of payments) {
    if (statementIds.has(p.statementId)) {
      paid.ARS += p.amountARS;
      paid.USD += p.amountUSD;
    }
  }
  return paid;
}

/**
 * Totales, saldo arrastrado y estado del resumen `period`. El saldo anterior se calcula en cadena
 * desde el primer mes con movimiento; solo se arrastra el de resúmenes ya vencidos, y nunca es
 * negativo (un pago de más no se arrastra).
 */
export function statementSummary(
  card: Pick<Card, 'id'> & CardDefaults,
  statements: readonly Statement[],
  installments: readonly Installment[],
  payments: readonly StatementPayment[],
  period: string,
  todayDate: string,
): StatementSummary {
  const mine = installments.filter((i) => i.cardId === card.id);
  const myStatementPeriods = statements.filter((s) => s.cardId === card.id).map((s) => s.period);
  const earliest = [...mine.map((i) => i.period), ...myStatementPeriods, period].sort()[0]!;

  let carry: Totals = { ARS: 0, USD: 0 };
  let result!: StatementSummary;
  for (let p = earliest; p <= period; p = addMonths(p, 1)) {
    const total = totalsFor(mine, card.id, p);
    const paid = paymentsFor(statements, payments, card.id, p);
    const remainingARS = total.ARS + carry.ARS - paid.ARS;
    const remainingUSD = total.USD + carry.USD - paid.USD;
    const resolved = resolveStatement(card, statements, p);

    if (p === period) {
      result = {
        ...resolved,
        totalARS: total.ARS,
        totalUSD: total.USD,
        previousBalanceARS: carry.ARS,
        previousBalanceUSD: carry.USD,
        paidARS: paid.ARS,
        paidUSD: paid.USD,
        remainingARS,
        remainingUSD,
        status: statementStatus(resolved, remainingARS, remainingUSD, paid.ARS + paid.USD, todayDate),
      };
    }
    // El saldo solo se arrastra si el resumen ya venció sin pagarse; antes es una deuda normal de
    // ese resumen y sumarla al siguiente la contaría dos veces al mirar meses futuros.
    const overdue = compareIso(todayDate, resolved.dueDate) > 0;
    carry = overdue ? { ARS: Math.max(0, remainingARS), USD: Math.max(0, remainingUSD) } : { ARS: 0, USD: 0 };
  }
  return result;
}

function statementStatus(
  statement: Pick<ResolvedStatement, 'closingDate' | 'dueDate'>,
  remainingARS: number,
  remainingUSD: number,
  paid: number,
  todayDate: string,
): StatementStatus {
  if (compareIso(todayDate, statement.closingDate) <= 0) return 'open';
  if (remainingARS <= 0 && remainingUSD <= 0) return 'paid';
  if (compareIso(todayDate, statement.dueDate) > 0) return 'overdue';
  return paid > 0 ? 'partial' : 'closed';
}

// ---------- 4.6 Compromiso futuro ----------

export interface MonthCommitment {
  period: string;
  totalARS: number;
  totalUSD: number;
  byCard: Record<string, { ARS: number; USD: number }>;
}

/** Total en cuotas programadas de cada mes (todas las tarjetas y por tarjeta). */
export function futureCommitments(
  installments: readonly Installment[],
  fromPeriod: string,
  months = 12,
): MonthCommitment[] {
  const result: MonthCommitment[] = Array.from({ length: months }, (_, i) => ({
    period: addMonths(fromPeriod, i),
    totalARS: 0,
    totalUSD: 0,
    byCard: {},
  }));
  const byPeriod = new Map(result.map((m) => [m.period, m]));
  for (const i of installments) {
    const month = byPeriod.get(i.period);
    if (!month || i.status !== 'scheduled') continue;
    const card = (month.byCard[i.cardId] ??= { ARS: 0, USD: 0 });
    card[i.currency] += i.amount;
    if (i.currency === 'ARS') month.totalARS += i.amount;
    else month.totalUSD += i.amount;
  }
  return result;
}

// ---------- 4.7 Límite disponible ----------

/**
 * Límite − cuotas programadas en pesos (de todos los resúmenes) + lo ya pagado: en Argentina la
 * compra en cuotas consume el límite por el total, y cada pago lo libera.
 */
export function availableLimit(
  card: Pick<Card, 'id' | 'limit'>,
  statements: readonly Statement[],
  installments: readonly Installment[],
  payments: readonly StatementPayment[],
): number | undefined {
  if (card.limit === undefined) return undefined;
  const committed = installments
    .filter((i) => i.cardId === card.id && i.status === 'scheduled' && i.currency === 'ARS')
    .reduce((sum, i) => sum + i.amount, 0);
  const cardStatementIds = new Set(statements.filter((s) => s.cardId === card.id).map((s) => s.id));
  const paid = payments.filter((p) => cardStatementIds.has(p.statementId)).reduce((sum, p) => sum + p.amountARS, 0);
  return card.limit - (committed - paid);
}

// ---------- 5.4 Cuotas pendientes ----------

export interface ActivePurchase {
  purchase: CardPurchase;
  /** Número de la cuota que cae en el resumen actual (o en el próximo que tenga una). */
  currentNumber: number;
  /** Suma de las cuotas programadas desde el resumen actual en adelante. */
  remaining: number;
  lastPeriod: string;
}

/** Compras en cuotas que todavía tienen cuotas por pagar desde `currentPeriod`. */
export function activePurchases(
  purchases: readonly CardPurchase[],
  installments: readonly Installment[],
  currentPeriod: string,
): ActivePurchase[] {
  const result: ActivePurchase[] = [];
  for (const purchase of purchases) {
    if (purchase.installments < 2) continue;
    const pending = installments
      .filter((i) => i.purchaseId === purchase.id && i.status === 'scheduled' && i.period >= currentPeriod)
      .sort((a, b) => compareIso(a.period, b.period));
    if (pending.length === 0) continue;
    result.push({
      purchase,
      currentNumber: pending[0]!.number,
      remaining: pending.reduce((sum, i) => sum + i.amount, 0),
      lastPeriod: pending[pending.length - 1]!.period,
    });
  }
  return result.sort((a, b) => a.purchase.description.localeCompare(b.purchase.description, 'es'));
}
