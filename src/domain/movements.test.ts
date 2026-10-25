import { describe, expect, it } from 'vitest';
import { buildMovementRows } from './movements';
import type { Card, CardPurchase, Category, Installment, Statement, Transaction } from './types';

const visa: Card = { id: 'visa', name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false };
const master: Card = { id: 'master', name: 'Master', defaultClosingDay: 5, defaultDueDay: 15, archived: false };
const categories: Category[] = [
  { id: 'tec', name: 'Tecnología', kind: 'expense' },
  { id: 'comida', name: 'Comida', kind: 'expense' },
  { id: 'super', name: 'Supermercado', kind: 'expense', parentId: 'comida' },
];
const purchases: CardPurchase[] = [
  { id: 'tv', cardId: 'visa', date: '2026-10-20', description: 'TV Samsung', categoryId: 'tec', currency: 'ARS', installments: 6, amountMode: 'total', totalAmount: 600, startInstallment: 1, isRefund: false },
  { id: 'coto', cardId: 'master', date: '2026-10-20', description: 'Coto', categoryId: 'super', currency: 'ARS', installments: 1, amountMode: 'total', totalAmount: 50, startInstallment: 1, isRefund: false },
];
const inst = (id: string, purchaseId: string, cardId: string, period: string, extra: Partial<Installment> = {}): Installment => ({
  id, purchaseId, cardId, number: 2, of: 6, period, amount: 100, currency: 'ARS', categoryId: purchaseId === 'tv' ? 'tec' : 'super', status: 'scheduled', ...extra,
});
const installments = [
  inst('i1', 'tv', 'visa', '2026-12'),
  inst('i2', 'tv', 'visa', '2027-01'),
  inst('i3', 'coto', 'master', '2026-12', { number: 1, of: 1, amount: 50 }),
  inst('i4', 'tv', 'visa', '2026-12', { status: 'cancelled' }),
];
const transactions: Transaction[] = [
  { id: 't1', type: 'expense', accountId: 'banco', amount: 10, date: '2026-12-03', description: 'Café', categoryId: 'comida' },
  { id: 't2', type: 'income', accountId: 'banco', amount: 10, date: '2026-12-05', description: 'Sueldo' },
];
const data = { transactions, installments, purchases, cards: [visa, master], statements: [] as Statement[], categories };
const ids = (filters: Parameters<typeof buildMovementRows>[1]) => buildMovementRows(data, filters).map((r) => r.id).sort();

describe('buildMovementRows', () => {
  it('mezcla movimientos y cuotas programadas del mes (ignora las canceladas)', () => {
    expect(ids({ month: '2026-12' })).toEqual(['i1', 'i3', 't1', 't2']);
    expect(ids({ month: '2027-01' })).toEqual(['i2']);
  });

  it('la cuota cae en la fecha de vencimiento de su resumen, respetando fechas editadas', () => {
    const rows = buildMovementRows(data, { month: '2026-12', cardId: 'visa' });
    expect(rows.map((r) => r.date)).toEqual(['2026-12-20']);
    const edited: Statement = { id: 's', cardId: 'visa', period: '2026-12', closingDate: '2026-12-12', dueDate: '2026-12-23' };
    expect(buildMovementRows({ ...data, statements: [edited] }, { month: '2026-12', cardId: 'visa' })[0]!.date).toBe('2026-12-23');
  });

  it('filtro por tarjeta muestra solo sus cuotas', () => {
    expect(ids({ month: '2026-12', cardId: 'master' })).toEqual(['i3']);
  });

  it('filtro por cuenta oculta las cuotas', () => {
    expect(ids({ month: '2026-12', accountId: 'banco' })).toEqual(['t1', 't2']);
  });

  it('filtro por tipo', () => {
    expect(ids({ month: '2026-12', type: 'card' })).toEqual(['i1', 'i3']);
    expect(ids({ month: '2026-12', type: 'income' })).toEqual(['t2']);
    expect(ids({ month: '2026-12', type: 'expense' })).toEqual(['i1', 'i3', 't1']);
  });

  it('categoría padre incluye subcategorías, también en cuotas', () => {
    expect(ids({ month: '2026-12', categoryId: 'comida' })).toEqual(['i3', 't1']);
  });

  it('búsqueda por descripción, categoría o tarjeta, sin tildes', () => {
    expect(ids({ month: '2026-12', text: 'samsung' })).toEqual(['i1']);
    expect(ids({ month: '2026-12', text: 'tecnologia' })).toEqual(['i1']);
    expect(ids({ month: '2026-12', text: 'master' })).toEqual(['i3']);
  });
});
