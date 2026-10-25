import { describe, expect, it } from 'vitest';
import { statementSummary } from './cards';
import { allocatePayment, paymentAccountAmount, periodsWithPayments, validatePayment } from './payments';
import type { Card, Installment, Statement, StatementPayment } from './types';

const card: Card = { id: 'visa', name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false };

let seq = 0;
const inst = (period: string, amount: number, currency: 'ARS' | 'USD' = 'ARS'): Installment => ({
  id: `i${++seq}`, purchaseId: 'p', cardId: 'visa', number: 1, of: 1, period, amount, currency, categoryId: 'c', status: 'scheduled',
});
const st = (period: string, id: string): Statement => ({
  id, cardId: 'visa', period, closingDate: `${period}-10`, dueDate: `${period}-20`,
});
const pay = (statementId: string, amountARS: number, amountUSD = 0): StatementPayment => ({
  id: `p${++seq}`, statementId, accountId: 'a', date: '2026-11-18', amountARS, amountUSD,
});

const installments = [inst('2026-11', 100_000), inst('2026-12', 50_000)];

describe('validatePayment', () => {
  const ars = { currency: 'ARS' as const };
  const usd = { currency: 'USD' as const };
  const owed = { remainingARS: 100_000, remainingUSD: 5_000 };

  it('pago válido en pesos, parcial o total', () => {
    expect(validatePayment({ amountARS: 40_000, amountUSD: 0 }, ars, owed)).toEqual([]);
    expect(validatePayment({ amountARS: 100_000, amountUSD: 0 }, ars, owed)).toEqual([]);
  });

  it('rechaza montos inválidos, cero y pagar de más', () => {
    expect(validatePayment({ amountARS: -1, amountUSD: 0 }, ars, owed)).toEqual(['Los montos no son válidos.']);
    expect(validatePayment({ amountARS: 1.5, amountUSD: 0 }, ars, owed)).toEqual(['Los montos no son válidos.']);
    expect(validatePayment({ amountARS: 0, amountUSD: 0 }, ars, owed)).toEqual(['Ingresá cuánto vas a pagar.']);
    expect(validatePayment({ amountARS: 100_001, amountUSD: 0 }, ars, owed)[0]).toContain('en pesos');
    expect(validatePayment({ amountARS: 0, amountUSD: 5_001 }, usd, owed)[0]).toContain('en dólares');
  });

  it('con saldo a favor o nada que pagar no se puede pagar', () => {
    expect(validatePayment({ amountARS: 1, amountUSD: 0 }, ars, { remainingARS: -500, remainingUSD: 0 })).toHaveLength(1);
  });

  it('dólares con pesos exige cotización', () => {
    expect(validatePayment({ amountARS: 0, amountUSD: 1_000 }, ars, owed)).toEqual(['Para pagar dólares con pesos indicá la cotización.']);
    expect(validatePayment({ amountARS: 0, amountUSD: 1_000, exchangeRate: 1_200 }, ars, owed)).toEqual([]);
  });

  it('una cuenta en dólares no paga pesos y no necesita cotización', () => {
    expect(validatePayment({ amountARS: 10, amountUSD: 1_000 }, usd, owed)).toEqual(['Una cuenta en dólares solo puede pagar el saldo en dólares.']);
    expect(validatePayment({ amountARS: 0, amountUSD: 1_000 }, usd, owed)).toEqual([]);
  });
});

describe('paymentAccountAmount', () => {
  it('cuenta en pesos: pesos más dólares convertidos a la cotización', () => {
    // US$ 10,00 a $ 1.250,50 = $ 12.505,00
    expect(paymentAccountAmount({ amountARS: 50_000, amountUSD: 1_000, exchangeRate: 1_250.5 }, { currency: 'ARS' })).toBe(50_000 + 1_250_500);
    expect(paymentAccountAmount({ amountARS: 50_000, amountUSD: 0 }, { currency: 'ARS' })).toBe(50_000);
  });

  it('cuenta en dólares: sale el monto en dólares', () => {
    expect(paymentAccountAmount({ amountARS: 0, amountUSD: 1_000, exchangeRate: 1_250 }, { currency: 'USD' })).toBe(1_000);
  });
});

describe('allocatePayment', () => {
  const alloc = (amountARS: number, today: string, period = '2026-12', payments: StatementPayment[] = [], statements: Statement[] = [], amountUSD = 0, items = installments) =>
    allocatePayment(card, statements, items, payments, period, amountARS, amountUSD, today);

  it('con el resumen anterior vencido, el pago salda primero el más viejo y el resto va al elegido', () => {
    expect(alloc(150_000, '2026-12-21')).toEqual([
      { period: '2026-11', amountARS: 100_000, amountUSD: 0 },
      { period: '2026-12', amountARS: 50_000, amountUSD: 0 },
    ]);
    expect(alloc(110_000, '2026-12-21')).toEqual([
      { period: '2026-11', amountARS: 100_000, amountUSD: 0 },
      { period: '2026-12', amountARS: 10_000, amountUSD: 0 },
    ]);
  });

  it('un pago chico queda todo en el resumen vencido', () => {
    expect(alloc(60_000, '2026-12-21')).toEqual([{ period: '2026-11', amountARS: 60_000, amountUSD: 0 }]);
  });

  it('descuenta lo ya pagado de cada resumen', () => {
    const statements = [st('2026-11', 's-nov')];
    expect(alloc(90_000, '2026-12-21', '2026-12', [pay('s-nov', 40_000)], statements)).toEqual([
      { period: '2026-11', amountARS: 60_000, amountUSD: 0 },
      { period: '2026-12', amountARS: 30_000, amountUSD: 0 },
    ]);
  });

  it('si el resumen anterior todavía no venció, no entra en el reparto', () => {
    expect(alloc(50_000, '2026-11-19')).toEqual([{ period: '2026-12', amountARS: 50_000, amountUSD: 0 }]);
  });

  it('pagar el resumen más viejo no toca a los nuevos', () => {
    expect(alloc(100_000, '2026-12-21', '2026-11')).toEqual([{ period: '2026-11', amountARS: 100_000, amountUSD: 0 }]);
  });

  it('reparte pesos y dólares por separado', () => {
    const items = [...installments, inst('2026-11', 3_000, 'USD'), inst('2026-12', 2_000, 'USD')];
    expect(alloc(150_000, '2026-12-21', '2026-12', [], [], 5_000, items)).toEqual([
      { period: '2026-11', amountARS: 100_000, amountUSD: 3_000 },
      { period: '2026-12', amountARS: 50_000, amountUSD: 2_000 },
    ]);
  });

  it('error si el pago supera la deuda', () => {
    expect(() => alloc(150_001, '2026-12-21')).toThrow(RangeError);
  });

  it('los pagos repartidos saldan el resumen vencido y no dejan deuda doble', () => {
    const statements = [st('2026-11', 's-nov'), st('2026-12', 's-dic')];
    const payments = [pay('s-nov', 100_000), pay('s-dic', 10_000)]; // pago de 110.000 desde diciembre
    const nov = statementSummary(card, statements, installments, payments, '2026-11', '2026-12-21');
    const dic = statementSummary(card, statements, installments, payments, '2026-12', '2026-12-21');
    expect(nov).toMatchObject({ remainingARS: 0, status: 'paid' });
    expect(dic).toMatchObject({ previousBalanceARS: 0, totalARS: 50_000, paidARS: 10_000, remainingARS: 40_000 });
  });
});

describe('periodsWithPayments', () => {
  it('lista los períodos de la tarjeta con algún pago', () => {
    const statements = [st('2026-11', 's-nov'), st('2026-12', 's-dic'), { ...st('2026-11', 's-other'), cardId: 'master' }];
    const payments = [pay('s-nov', 10), pay('s-dic', 0), pay('s-other', 99)];
    expect([...periodsWithPayments(card, statements, payments)]).toEqual(['2026-11']);
  });
});
