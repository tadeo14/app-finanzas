import { describe, expect, it } from 'vitest';
import { consolidateARS, nextDue } from './dashboard';
import type { Card, Installment, Statement, StatementPayment } from './types';

describe('consolidateARS', () => {
  it('suma pesos y dólares a la cotización', () => {
    expect(consolidateARS({ ARS: 100_000, USD: 1_000 }, 1_200)).toBe(100_000 + 1_200_000);
  });
  it('sin dólares no hace falta cotización', () => {
    expect(consolidateARS({ ARS: 100_000, USD: 0 })).toBe(100_000);
  });
  it('con dólares y sin cotización no se puede consolidar', () => {
    expect(consolidateARS({ ARS: 1, USD: 1 })).toBeUndefined();
    expect(consolidateARS({ ARS: 1, USD: 1 }, 0)).toBeUndefined();
  });
});

describe('nextDue', () => {
  const card: Card = { id: 'visa', name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false };
  let seq = 0;
  const inst = (period: string, amount: number, currency: 'ARS' | 'USD' = 'ARS'): Installment => ({
    id: `i${++seq}`, purchaseId: 'p', cardId: 'visa', number: 1, of: 1, period, amount, currency, categoryId: 'c', status: 'scheduled',
  });
  const items = [inst('2026-10', 50_000), inst('2026-11', 30_000), inst('2026-11', 700, 'USD')];

  it('hoy 25/10: el resumen de octubre (cerró el 10, vence el 20) ya venció impago', () => {
    expect(nextDue(card, [], items, [], '2026-10-25')).toEqual({
      cardId: 'visa', period: '2026-10', dueDate: '2026-10-20', remainingARS: 50_000, remainingUSD: 0, daysLeft: -5, overdue: true,
    });
  });

  it('hoy 15/10: octubre cerrado y por vencer en 5 días', () => {
    expect(nextDue(card, [], items, [], '2026-10-15')).toMatchObject({ period: '2026-10', daysLeft: 5, overdue: false, remainingARS: 50_000 });
  });

  it('con octubre pagado, el próximo es el resumen abierto de noviembre', () => {
    const statements: Statement[] = [{ id: 's-oct', cardId: 'visa', period: '2026-10', closingDate: '2026-10-10', dueDate: '2026-10-20' }];
    const payments: StatementPayment[] = [{ id: 'p1', statementId: 's-oct', accountId: 'a', date: '2026-10-18', amountARS: 50_000, amountUSD: 0 }];
    expect(nextDue(card, statements, items, payments, '2026-10-25')).toMatchObject({
      period: '2026-11', dueDate: '2026-11-20', daysLeft: 26, overdue: false, remainingARS: 30_000, remainingUSD: 700,
    });
  });

  it('el vencimiento de hoy no está vencido (daysLeft 0)', () => {
    expect(nextDue(card, [], items, [], '2026-10-20')).toMatchObject({ daysLeft: 0, overdue: false });
  });

  it('sin deuda no hay próximo vencimiento', () => {
    expect(nextDue(card, [], [], [], '2026-10-25')).toBeNull();
  });
});
