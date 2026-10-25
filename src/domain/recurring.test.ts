import { describe, expect, it } from 'vitest';
import { nextOccurrence, occurrencesDue, purchaseFor, transactionFor, validateRecurring } from './recurring';
import type { Recurring } from './types';

const base = (extra: Partial<Recurring> = {}): Recurring => ({
  id: 'r1',
  kind: 'transaction',
  template: { type: 'expense', accountId: 'banco', amount: 1000, categoryId: 'serv', description: 'Netflix' },
  frequency: 'monthly',
  startDate: '2026-01-15',
  ...extra,
});

describe('occurrencesDue mensual', () => {
  it('genera una por mes desde el inicio hasta hoy, inclusive', () => {
    expect(occurrencesDue(base(), '2026-04-15')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    expect(occurrencesDue(base(), '2026-04-14')).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('antes del inicio no hay nada', () => {
    expect(occurrencesDue(base(), '2026-01-14')).toEqual([]);
  });

  it('continúa después de lastGenerated y no repite', () => {
    const r = base({ lastGenerated: '2026-02-15' });
    expect(occurrencesDue(r, '2026-04-20')).toEqual(['2026-03-15', '2026-04-15']);
    expect(occurrencesDue(base({ lastGenerated: '2026-04-15' }), '2026-04-20')).toEqual([]);
  });

  it('respeta endDate', () => {
    expect(occurrencesDue(base({ endDate: '2026-03-01' }), '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
    expect(occurrencesDue(base({ endDate: '2026-03-15' }), '2026-12-31')).toContain('2026-03-15');
  });

  it('día 31 se recorta en meses cortos y febrero (bisiesto y no)', () => {
    const r = base({ startDate: '2027-01-31' });
    expect(occurrencesDue(r, '2027-05-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect(occurrencesDue(base({ startDate: '2028-01-31' }), '2028-03-01')).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('dayOfMonth distinto al día de inicio: la primera ocurrencia no es anterior al inicio', () => {
    const r = base({ startDate: '2026-01-20', dayOfMonth: 5 });
    expect(occurrencesDue(r, '2026-04-30')).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
    const early = base({ startDate: '2026-01-02', dayOfMonth: 5 });
    expect(occurrencesDue(early, '2026-02-28')).toEqual(['2026-01-05', '2026-02-05']);
  });

  it('cruza el cambio de año', () => {
    expect(occurrencesDue(base({ startDate: '2026-11-10' }), '2027-02-10')).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10']);
  });
});

describe('occurrencesDue semanal y anual', () => {
  it('semanal: cada 7 días', () => {
    const r = base({ frequency: 'weekly', startDate: '2026-10-01' });
    expect(occurrencesDue(r, '2026-10-22')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
  });

  it('anual: mismo día y mes, y el 29/02 cae el 28/02 en años no bisiestos', () => {
    expect(occurrencesDue(base({ frequency: 'yearly', startDate: '2024-03-10' }), '2026-12-31')).toEqual(['2024-03-10', '2025-03-10', '2026-03-10']);
    expect(occurrencesDue(base({ frequency: 'yearly', startDate: '2024-02-29' }), '2026-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });

  it('el tope evita generar de más', () => {
    expect(occurrencesDue(base({ frequency: 'weekly', startDate: '2000-01-01' }), '2026-12-31', 50)).toHaveLength(50);
  });
});

describe('nextOccurrence', () => {
  it('la primera posterior a hoy', () => {
    expect(nextOccurrence(base(), '2026-04-15')).toBe('2026-05-15');
    expect(nextOccurrence(base(), '2026-04-14')).toBe('2026-04-15');
    expect(nextOccurrence(base({ startDate: '2027-01-01' }), '2026-10-25')).toBe('2027-01-01');
  });

  it('null si ya terminó', () => {
    expect(nextOccurrence(base({ endDate: '2026-03-31' }), '2026-04-15')).toBeNull();
  });
});

describe('validateRecurring', () => {
  const { id: _id, ...ok } = base();

  it('uno válido', () => {
    expect(validateRecurring(ok)).toEqual([]);
  });

  it.each([
    [{ startDate: '2026-02-30' }, 'inicio'],
    [{ endDate: '2025-12-31' }, 'fin'],
    [{ dayOfMonth: 32 }, 'día del mes'],
    [{ template: { type: 'expense' as const, amount: 100 } }, 'cuenta'],
    [{ template: { type: 'expense' as const, accountId: 'a', amount: 0 } }, 'monto'],
    [{ template: { type: 'transfer' as const, accountId: 'a', amount: 5 } }, 'gasto o un ingreso'],
  ])('rechaza %j', (extra, fragment) => {
    expect(validateRecurring({ ...ok, ...extra }).join(' ').toLowerCase()).toContain(fragment);
  });

  it('suscripción con tarjeta: pide tarjeta, categoría y monto', () => {
    const card = { ...ok, kind: 'cardPurchase' as const, template: {} };
    expect(validateRecurring(card)).toHaveLength(3);
    expect(validateRecurring({ ...card, template: { cardId: 'visa', categoryId: 'sus', totalAmount: 5000 } })).toEqual([]);
  });
});

describe('armado de movimientos', () => {
  it('transactionFor toma la plantilla, la fecha y vincula al recurrente', () => {
    expect(transactionFor(base(), '2026-02-15', 'x')).toEqual({
      id: 'x', type: 'expense', accountId: 'banco', amount: 1000, categoryId: 'serv', description: 'Netflix', date: '2026-02-15', recurringId: 'r1',
    });
  });

  it('purchaseFor genera una compra de 1 cuota', () => {
    const r = base({ kind: 'cardPurchase', template: { cardId: 'visa', categoryId: 'sus', totalAmount: 5000, description: 'Spotify', installments: 12 } });
    expect(purchaseFor(r, '2026-02-15', 'p')).toEqual({
      id: 'p', cardId: 'visa', categoryId: 'sus', totalAmount: 5000, description: 'Spotify', currency: 'ARS',
      date: '2026-02-15', installments: 1, amountMode: 'total', startInstallment: 1, isRefund: false, recurringId: 'r1',
    });
  });
});
