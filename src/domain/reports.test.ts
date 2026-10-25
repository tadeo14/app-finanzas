import { describe, expect, it } from 'vitest';
import {
  budgetLevel,
  budgetProgress,
  effectiveBudget,
  entriesForMonth,
  expensesByCategory,
  monthlySeries,
  NO_CATEGORY,
  sliceRows,
  spentByCategory,
  sumARS,
  toARS,
  type ReportSources,
} from './reports';
import type { Account, Budget, Category, Installment, Transaction } from './types';

const ars: Account = { id: 'ars', name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 0, archived: false };
const usd: Account = { id: 'usd', name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 0, archived: false };

const categories: Category[] = [
  { id: 'comida', name: 'Comida', kind: 'expense' },
  { id: 'super', name: 'Supermercado', kind: 'expense', parentId: 'comida' },
  { id: 'rest', name: 'Restaurantes', kind: 'expense', parentId: 'comida' },
  { id: 'bar', name: 'Bares', kind: 'expense', parentId: 'rest' }, // nivel 3
  { id: 'tec', name: 'Tecnología', kind: 'expense' },
  { id: 'sueldo', name: 'Sueldo', kind: 'income' },
  { id: 'card-payment', name: 'Pago de tarjeta', kind: 'expense' },
];

let seq = 0;
const tx = (extra: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, accountId: 'ars', date: '2026-10-10', description: '', ...extra,
});
const inst = (extra: Partial<Installment>): Installment => ({
  id: `i${++seq}`, purchaseId: 'p', cardId: 'visa', number: 1, of: 1, period: '2026-10', amount: 1000, currency: 'ARS', categoryId: 'tec', status: 'scheduled', ...extra,
});

const src = (transactions: Transaction[], installments: Installment[] = [], accounts = [ars, usd]): ReportSources => ({
  transactions, installments, accounts, excludedCategoryIds: new Set(['card-payment']),
});

describe('entriesForMonth', () => {
  const data = src(
    [
      tx({ type: 'expense', amount: 500, categoryId: 'super' }),
      tx({ type: 'income', amount: 9000, categoryId: 'sueldo' }),
      tx({ type: 'transfer', amount: 700, toAccountId: 'usd' }),
      tx({ type: 'expense', amount: 800, categoryId: 'card-payment' }),
      tx({ type: 'expense', amount: 111, categoryId: 'super', date: '2026-09-30' }),
      tx({ type: 'expense', amount: 5, accountId: 'usd', categoryId: 'tec' }),
    ],
    [
      inst({ amount: 2000, period: '2026-10' }),
      inst({ amount: 3000, period: '2026-11' }),
      inst({ amount: 4000, period: '2026-10', status: 'cancelled' }),
      inst({ amount: -300, period: '2026-10' }), // devolución
    ],
  );

  it('gastos de cuenta por fecha y cuotas por período; ignora transferencias y pagos de tarjeta', () => {
    const { income, expense } = entriesForMonth(data, '2026-10');
    expect(income.map((e) => e.amount)).toEqual([9000]);
    expect(expense.map((e) => e.amount)).toEqual([500, 5, 2000, -300]);
  });

  it('una cuota de un mes futuro aparece en su mes y no en el actual', () => {
    expect(entriesForMonth(data, '2026-11').expense.map((e) => e.amount)).toEqual([3000]);
  });

  it('no cuenta dos veces: el gasto con tarjeta está en la cuota, no en el pago del resumen', () => {
    const only = src([tx({ type: 'expense', amount: 99_999, categoryId: 'card-payment' })], [inst({ amount: 1000 })]);
    expect(sumARS(entriesForMonth(only, '2026-10').expense).total).toBe(1000);
  });
});

describe('dólares', () => {
  it('toARS convierte solo con cotización', () => {
    expect(toARS({ amount: 1000, currency: 'ARS' })).toBe(1000);
    expect(toARS({ amount: 1000, currency: 'USD' })).toBeNull();
    expect(toARS({ amount: 1000, currency: 'USD' }, 0)).toBeNull();
    expect(toARS({ amount: 1000, currency: 'USD' }, 1200.5)).toBe(1_200_500);
  });

  it('sumARS informa si dejó dólares afuera', () => {
    const entries = [{ amount: 100, currency: 'ARS' as const }, { amount: 5, currency: 'USD' as const }];
    expect(sumARS(entries)).toEqual({ total: 100, skippedUSD: true });
    expect(sumARS(entries, 1000)).toEqual({ total: 5100, skippedUSD: false });
  });
});

describe('expensesByCategory', () => {
  const entries = [
    { categoryId: 'super', amount: 3000, currency: 'ARS' as const },
    { categoryId: 'rest', amount: 1000, currency: 'ARS' as const },
    { categoryId: 'bar', amount: 500, currency: 'ARS' as const },
    { categoryId: 'comida', amount: 200, currency: 'ARS' as const },
    { categoryId: 'tec', amount: 9000, currency: 'ARS' as const },
    { amount: 50, currency: 'ARS' as const },
    { categoryId: 'borrada', amount: 25, currency: 'ARS' as const },
  ];

  it('agrupa por categoría raíz con el detalle de subcategorías, mayores primero', () => {
    const { rows, total } = expensesByCategory(entries, categories);
    expect(total).toBe(13_775);
    expect(rows.map((r) => [r.categoryId, r.amount])).toEqual([
      ['tec', 9000],
      ['comida', 4700],
      [NO_CATEGORY, 75],
    ]);
    const comida = rows[1]!;
    expect(comida.own).toBe(200);
    // el nivel 3 (Bares) se suma a su ancestro directo bajo la raíz (Restaurantes)
    expect(comida.children).toEqual([
      { categoryId: 'super', amount: 3000 },
      { categoryId: 'rest', amount: 1500 },
    ]);
  });

  it('las devoluciones restan', () => {
    const { rows } = expensesByCategory([...entries, { categoryId: 'tec', amount: -2000, currency: 'ARS' }], categories);
    expect(rows[0]).toMatchObject({ categoryId: 'tec', amount: 7000 });
  });

  it('convierte dólares con la cotización y avisa si no hay', () => {
    const usdEntries = [{ categoryId: 'tec', amount: 100, currency: 'USD' as const }];
    expect(expensesByCategory(usdEntries, categories).skippedUSD).toBe(true);
    expect(expensesByCategory(usdEntries, categories, 1000).rows[0]!.amount).toBe(100_000);
  });

  it('tolera categorías con ciclo', () => {
    const cyclic: Category[] = [
      { id: 'a', name: 'A', kind: 'expense', parentId: 'b' },
      { id: 'b', name: 'B', kind: 'expense', parentId: 'a' },
    ];
    expect(() => expensesByCategory([{ categoryId: 'a', amount: 1, currency: 'ARS' }], cyclic)).not.toThrow();
  });
});

describe('sliceRows', () => {
  const rows = [10, 9, 8, 7, 6, 5, 4, 3].map((amount) => ({ amount }));

  it('hasta 6 segmentos: sin cambios', () => {
    expect(sliceRows(rows.slice(0, 6))).toEqual({ items: rows.slice(0, 6), othersAmount: 0, othersCount: 0 });
  });

  it('con más, los 5 mayores y "Otros" con el resto', () => {
    const { items, othersAmount, othersCount } = sliceRows(rows);
    expect(items).toHaveLength(5);
    expect(othersAmount).toBe(5 + 4 + 3);
    expect(othersCount).toBe(3);
  });

  it('descarta lo que no es positivo (no se dibuja en una torta)', () => {
    expect(sliceRows([{ amount: 5 }, { amount: 0 }, { amount: -3 }]).items).toEqual([{ amount: 5 }]);
  });
});

describe('monthlySeries', () => {
  const data = src(
    [
      tx({ type: 'income', amount: 10_000, date: '2026-10-05' }),
      tx({ type: 'expense', amount: 4_000, date: '2026-10-06' }),
      tx({ type: 'income', amount: 8_000, date: '2026-08-05' }),
    ],
    [inst({ amount: 1_000, period: '2026-10' }), inst({ amount: 2_500, period: '2026-12' }), inst({ amount: 2_500, period: '2027-01' })],
  );

  it('12 meses terminando en el actual, en orden', () => {
    const { points } = monthlySeries(data, '2026-10', undefined);
    expect(points).toHaveLength(12);
    expect(points[0]!.month).toBe('2025-11');
    expect(points[11]).toEqual({ month: '2026-10', income: 10_000, expense: 5_000, projected: false });
    expect(points.find((p) => p.month === '2026-08')).toMatchObject({ income: 8_000, expense: 0 });
    expect(points.every((p) => !p.projected)).toBe(true);
  });

  it('incluir cuotas futuras agrega meses proyectados con las cuotas ya programadas', () => {
    const { points } = monthlySeries(data, '2026-10', undefined, 12, 6);
    expect(points).toHaveLength(18);
    const future = points.slice(12);
    expect(future.map((p) => p.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(future.every((p) => p.projected)).toBe(true);
    expect(future.map((p) => p.expense)).toEqual([0, 2_500, 2_500, 0, 0, 0]);
  });
});

describe('presupuestos', () => {
  const budgets: Budget[] = [
    { id: '1', categoryId: 'comida', month: 'default', amount: 10_000 },
    { id: '2', categoryId: 'comida', month: '2026-12', amount: 20_000 },
    { id: '3', categoryId: 'tec', month: 'default', amount: 5_000 },
    { id: '4', categoryId: 'rest', month: '2026-10', amount: 0 },
  ];

  it('el presupuesto del mes pisa al default', () => {
    expect(effectiveBudget('comida', '2026-10', budgets)?.amount).toBe(10_000);
    expect(effectiveBudget('comida', '2026-12', budgets)?.amount).toBe(20_000);
    expect(effectiveBudget('rest', '2026-11', budgets)).toBeUndefined();
  });

  it('alerta al 80% y al 100%', () => {
    expect(budgetLevel(0.79)).toBe('ok');
    expect(budgetLevel(0.8)).toBe('warning');
    expect(budgetLevel(0.99)).toBe('warning');
    expect(budgetLevel(1)).toBe('over');
    expect(budgetLevel(1.5)).toBe('over');
  });

  it('el gasto de una categoría incluye sus subcategorías', () => {
    const entries = [
      { categoryId: 'super', amount: 3000, currency: 'ARS' as const },
      { categoryId: 'bar', amount: 500, currency: 'ARS' as const },
      { categoryId: 'comida', amount: 100, currency: 'ARS' as const },
    ];
    const spent = spentByCategory(entries, categories);
    expect(spent.get('comida')).toBe(3600);
    expect(spent.get('rest')).toBe(500);
    expect(spent.get('super')).toBe(3000);
  });

  it('avance de cada presupuesto vigente, el más comprometido primero, ignorando los de monto cero', () => {
    const entries = [
      { categoryId: 'super', amount: 9_000, currency: 'ARS' as const },
      { categoryId: 'tec', amount: 1_000, currency: 'ARS' as const },
    ];
    const progress = budgetProgress('2026-10', budgets, categories, entries);
    expect(progress.map((p) => [p.categoryId, p.spent, p.budget, p.level])).toEqual([
      ['comida', 9_000, 10_000, 'warning'],
      ['tec', 1_000, 5_000, 'ok'],
    ]);
    expect(progress[0]!.ratio).toBeCloseTo(0.9);
  });

  it('cuenta las cuotas de tarjeta del mes y pasa al nivel excedido', () => {
    const data = src([], [inst({ categoryId: 'tec', amount: 6_000, period: '2026-10' })]);
    const { expense } = entriesForMonth(data, '2026-10');
    expect(budgetProgress('2026-10', budgets, categories, expense)[0]).toMatchObject({ categoryId: 'tec', level: 'over' });
  });
});
