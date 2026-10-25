import { describe, expect, it } from 'vitest';
import {
  accountBalance,
  balancesById,
  categoryWithDescendants,
  filterTransactions,
  groupByDay,
  incomeAndExpense,
  totalsByCurrency,
  validateTransaction,
} from './accounts';
import type { Account, Category, Transaction } from './types';

const banco: Account = { id: 'banco', name: 'Banco', type: 'bank', currency: 'ARS', initialBalance: 100_000, archived: false };
const efectivo: Account = { id: 'efectivo', name: 'Efectivo', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false };
const dolares: Account = { id: 'usd', name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 5_000, archived: false };
const vieja: Account = { id: 'vieja', name: 'Vieja', type: 'bank', currency: 'ARS', initialBalance: 999, archived: true };
const accounts = [banco, efectivo, dolares, vieja];

let seq = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, 'type' | 'accountId' | 'amount'>): Transaction {
  return { id: `t${++seq}`, date: '2026-10-10', description: '', ...partial };
}

const transactions: Transaction[] = [
  tx({ type: 'income', accountId: 'banco', amount: 50_000, categoryId: 'sueldo', description: 'Sueldo octubre' }),
  tx({ type: 'expense', accountId: 'banco', amount: 20_000, categoryId: 'super', description: 'Coto', date: '2026-10-12' }),
  tx({ type: 'transfer', accountId: 'banco', toAccountId: 'efectivo', amount: 10_000, description: 'Cajero' }),
  // compra de dólares: salen $ 120.000,00 del banco y entran US$ 100,00
  tx({ type: 'transfer', accountId: 'banco', toAccountId: 'usd', amount: 12_000_000, toAmount: 10_000, description: 'Compra USD', date: '2026-09-30' }),
  tx({ type: 'expense', accountId: 'efectivo', amount: 3_000, categoryId: 'cafe', description: 'Café con medialunas', date: '2026-10-12' }),
];

describe('saldos', () => {
  it('saldo = inicial + ingresos − gastos ± transferencias', () => {
    expect(accountBalance(banco, transactions)).toBe(100_000 + 50_000 - 20_000 - 10_000 - 12_000_000);
    expect(accountBalance(efectivo, transactions)).toBe(10_000 - 3_000);
  });

  it('transferencia entre monedas acredita toAmount en la cuenta destino', () => {
    expect(accountBalance(dolares, transactions)).toBe(5_000 + 10_000);
  });

  it('balancesById coincide con accountBalance', () => {
    const balances = balancesById(accounts, transactions);
    for (const account of accounts) {
      expect(balances.get(account.id)).toBe(accountBalance(account, transactions));
    }
  });

  it('totales por moneda excluyen cuentas archivadas', () => {
    const totals = totalsByCurrency(accounts, balancesById(accounts, transactions));
    expect(totals.ARS).toBe(100_000 + 50_000 - 20_000 - 10_000 - 12_000_000 + 7_000);
    expect(totals.USD).toBe(15_000);
  });
});

describe('validateTransaction', () => {
  const base = { date: '2026-10-10', description: '' };

  it('gasto válido', () => {
    expect(validateTransaction({ ...base, type: 'expense', accountId: 'banco', amount: 100 }, accounts)).toEqual([]);
  });

  it('monto cero, negativo o con decimales', () => {
    for (const amount of [0, -5, 1.5]) {
      expect(validateTransaction({ ...base, type: 'expense', accountId: 'banco', amount }, accounts)).toHaveLength(1);
    }
  });

  it('fecha y cuenta inválidas', () => {
    const errors = validateTransaction({ ...base, date: '2026-02-30', type: 'income', accountId: 'nada', amount: 1 }, accounts);
    expect(errors).toHaveLength(2);
  });

  it('transferencia a la misma cuenta', () => {
    const errors = validateTransaction({ ...base, type: 'transfer', accountId: 'banco', toAccountId: 'banco', amount: 1 }, accounts);
    expect(errors).toEqual(['La cuenta destino tiene que ser distinta de la de origen.']);
  });

  it('transferencia entre monedas exige toAmount', () => {
    const t = { ...base, type: 'transfer' as const, accountId: 'banco', toAccountId: 'usd', amount: 1000 };
    expect(validateTransaction(t, accounts)).toEqual(['Indicá cuánto llega en USD.']);
    expect(validateTransaction({ ...t, toAmount: 1 }, accounts)).toEqual([]);
  });

  it('gasto con cuenta destino es inválido', () => {
    expect(validateTransaction({ ...base, type: 'expense', accountId: 'banco', toAccountId: 'efectivo', amount: 1 }, accounts)).toHaveLength(1);
  });
});

describe('filtros', () => {
  const categories: Category[] = [
    { id: 'comida', name: 'Comida', kind: 'expense' },
    { id: 'super', name: 'Supermercado', kind: 'expense', parentId: 'comida' },
    { id: 'cafe', name: 'Cafetería', kind: 'expense', parentId: 'comida' },
    { id: 'sueldo', name: 'Sueldo', kind: 'income' },
  ];

  it('por mes', () => {
    expect(filterTransactions(transactions, { month: '2026-09' }).map((t) => t.description)).toEqual(['Compra USD']);
  });

  it('por cuenta incluye transferencias entrantes', () => {
    expect(filterTransactions(transactions, { accountId: 'efectivo' }).map((t) => t.description)).toEqual([
      'Cajero',
      'Café con medialunas',
    ]);
  });

  it('por categoría padre incluye subcategorías', () => {
    expect(categoryWithDescendants('comida', categories)).toEqual(new Set(['comida', 'super', 'cafe']));
    expect(filterTransactions(transactions, { categoryId: 'comida' }, categories)).toHaveLength(2);
  });

  it('por tipo', () => {
    expect(filterTransactions(transactions, { type: 'transfer' })).toHaveLength(2);
  });

  it('búsqueda sin tildes ni mayúsculas, también por nombre de categoría', () => {
    expect(filterTransactions(transactions, { text: 'CAFE' }, categories).map((t) => t.description)).toEqual([
      'Café con medialunas',
    ]);
    expect(filterTransactions(transactions, { text: 'supermer' }, categories).map((t) => t.description)).toEqual(['Coto']);
  });

  it('filtros combinados', () => {
    expect(filterTransactions(transactions, { month: '2026-10', accountId: 'banco', type: 'expense' })).toHaveLength(1);
  });
});

describe('groupByDay', () => {
  it('agrupa por fecha, más reciente primero', () => {
    const groups = groupByDay(transactions);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-12', '2026-10-10', '2026-09-30']);
    expect(groups[0]!.items.map((t) => t.description)).toEqual(['Coto', 'Café con medialunas']);
  });
});

describe('incomeAndExpense', () => {
  it('suma por moneda, ignora transferencias y categorías excluidas', () => {
    const result = incomeAndExpense(transactions, accounts, new Set(['cafe']));
    expect(result.ARS).toEqual({ income: 50_000, expense: 20_000 });
    expect(result.USD).toEqual({ income: 0, expense: 0 });
  });
});
