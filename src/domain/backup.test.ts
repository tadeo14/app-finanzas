import { describe, expect, it } from 'vitest';
import { backupReminder, BACKUP_TABLES, countRows, validateBackup } from './backup';
import { csvText, movementsToCSV } from './csv';

const valid = () => ({
  app: 'finanzas-personales',
  format: 1,
  exportedAt: '2026-10-25T12:00:00.000Z',
  data: {
    accounts: [{ id: 'a1', name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 1000, archived: false }],
    categories: [
      { id: 'c1', name: 'Comida', kind: 'expense' },
      { id: 'c2', name: 'Super', kind: 'expense', parentId: 'c1' },
    ],
    transactions: [
      { id: 't1', type: 'expense', accountId: 'a1', amount: 500, date: '2026-10-10', description: 'Coto', categoryId: 'c2', statementPaymentId: 'p1' },
    ],
    cards: [{ id: 'k1', name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false, limit: 100000 }],
    statements: [{ id: 's1', cardId: 'k1', period: '2026-11', closingDate: '2026-11-10', dueDate: '2026-11-20' }],
    cardPurchases: [
      { id: 'u1', cardId: 'k1', date: '2026-10-15', description: 'TV', categoryId: 'c1', currency: 'ARS', installments: 2, amountMode: 'total', totalAmount: 1000, startInstallment: 1, isRefund: false },
    ],
    installments: [
      { id: 'i1', purchaseId: 'u1', cardId: 'k1', number: 1, of: 2, period: '2026-11', amount: 500, currency: 'ARS', categoryId: 'c1', status: 'scheduled' },
    ],
    statementPayments: [{ id: 'p1', statementId: 's1', accountId: 'a1', date: '2026-11-18', amountARS: 500, amountUSD: 0, groupId: 'g' }],
    budgets: [{ id: 'b1', categoryId: 'c1', month: 'default', amount: 9000 }],
    recurrings: [{ id: 'r1', kind: 'transaction', template: { type: 'expense', accountId: 'a1', amount: 10 }, frequency: 'monthly', startDate: '2026-01-15' }],
    settings: [{ id: 'app', firstDayOfWeek: 1, usdRate: 1200.5, lastBackupAt: '2026-10-01' }],
  } as Record<string, unknown[]>,
});

const errorsOf = (mutate: (b: ReturnType<typeof valid>) => void) => {
  const b = valid();
  mutate(b);
  const result = validateBackup(b);
  return result.ok ? [] : result.errors;
};

describe('validateBackup', () => {
  it('acepta un backup completo y cuenta las filas', () => {
    const result = validateBackup(valid());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(countRows(result.backup)).toMatchObject({ accounts: 1, categories: 2, transactions: 1, installments: 1, settings: 1 });
      expect(Object.keys(result.backup.data)).toEqual([...BACKUP_TABLES]);
    }
  });

  it('acepta tablas vacías', () => {
    const b = valid();
    for (const table of BACKUP_TABLES) b.data[table] = [];
    expect(validateBackup(b).ok).toBe(true);
  });

  it.each([null, 'texto', 42, [], {}, { app: 'otra-app', format: 1, data: {} }])('rechaza algo que no es un backup: %j', (raw) => {
    const result = validateBackup(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('no es un backup');
  });

  it('rechaza una versión más nueva del formato', () => {
    expect(errorsOf((b) => { b.format = 99; })[0]).toContain('versión más nueva');
  });

  it('exige todas las tablas', () => {
    expect(errorsOf((b) => { delete b.data.budgets; })).toEqual(['Falta la tabla "budgets".']);
  });

  it('detecta campos inválidos con la tabla y la fila', () => {
    expect(errorsOf((b) => { (b.data.transactions![0] as Record<string, unknown>).amount = 1.5; })).toEqual(['transactions #1: el campo "amount" no es válido.']);
    expect(errorsOf((b) => { (b.data.transactions![0] as Record<string, unknown>).date = '2026-02-30'; })[0]).toContain('"date"');
    expect(errorsOf((b) => { (b.data.accounts![0] as Record<string, unknown>).currency = 'EUR'; })[0]).toContain('"currency"');
    expect(errorsOf((b) => { (b.data.cards![0] as Record<string, unknown>).defaultClosingDay = 32; })[0]).toContain('"defaultClosingDay"');
    expect(errorsOf((b) => { (b.data.installments![0] as Record<string, unknown>).period = '2026-13'; })[0]).toContain('"period"');
    expect(errorsOf((b) => { (b.data.settings![0] as Record<string, unknown>).usdRate = -1; })[0]).toContain('"usdRate"');
    expect(errorsOf((b) => { (b.data.settings![0] as Record<string, unknown>).theme = 'sepia'; })[0]).toContain('"theme"');
  });

  it('detecta filas sin id o con id repetido', () => {
    expect(errorsOf((b) => { b.data.categories!.push({ name: 'X', kind: 'expense' }); })[0]).toContain('no tiene id');
    expect(errorsOf((b) => { b.data.categories!.push({ id: 'c1', name: 'X', kind: 'expense' }); })[0]).toContain('id repetido');
  });

  it('detecta referencias a filas que no existen', () => {
    expect(errorsOf((b) => { (b.data.transactions![0] as Record<string, unknown>).accountId = 'nada'; })[0]).toContain('una cuenta que no existe');
    expect(errorsOf((b) => { (b.data.installments![0] as Record<string, unknown>).purchaseId = 'nada'; })[0]).toContain('una compra que no existe');
    expect(errorsOf((b) => { (b.data.statementPayments![0] as Record<string, unknown>).statementId = 'nada'; })[0]).toContain('un resumen que no existe');
    expect(errorsOf((b) => { (b.data.transactions![0] as Record<string, unknown>).statementPaymentId = 'nada'; })[0]).toContain('un pago que no existe');
  });

  it('detecta duplicados que romperían los índices únicos', () => {
    expect(errorsOf((b) => { b.data.statements!.push({ ...(b.data.statements![0] as object), id: 's2' }); })[0]).toContain('repetido (cardId + period)');
    expect(errorsOf((b) => { b.data.budgets!.push({ ...(b.data.budgets![0] as object), id: 'b2' }); })[0]).toContain('repetido (categoryId + month)');
  });

  it('limita la cantidad de errores informados', () => {
    const errors = errorsOf((b) => {
      b.data.transactions = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, type: 'x' }));
    });
    expect(errors.length).toBeLessThanOrEqual(15);
  });
});

describe('backupReminder', () => {
  it('avisa si pasaron más de 15 días desde el último export', () => {
    expect(backupReminder({ lastBackupAt: '2026-10-10' }, '2026-10-25', true)).toEqual({ due: false, days: 15, neverExported: false });
    expect(backupReminder({ lastBackupAt: '2026-10-09' }, '2026-10-25', true)).toEqual({ due: true, days: 16, neverExported: false });
  });

  it('si nunca exportó, cuenta desde que empezó a usar la app', () => {
    expect(backupReminder({ installedAt: '2026-09-01' }, '2026-10-25', true)).toEqual({ due: true, days: 54, neverExported: true });
    expect(backupReminder({ installedAt: '2026-10-20' }, '2026-10-25', true).due).toBe(false);
  });

  it('el último export manda sobre la fecha de instalación', () => {
    expect(backupReminder({ lastBackupAt: '2026-10-24', installedAt: '2026-01-01' }, '2026-10-25', true).due).toBe(false);
  });

  it('sin datos no hay nada que respaldar, y sin fechas no se puede saber', () => {
    expect(backupReminder({ installedAt: '2026-01-01' }, '2026-10-25', false).due).toBe(false);
    expect(backupReminder(undefined, '2026-10-25', true)).toEqual({ due: false, days: null, neverExported: true });
  });
});

describe('csvText', () => {
  it('entrecomilla lo que tiene ; o comillas', () => {
    expect(csvText('Cena; con amigos')).toBe('"Cena; con amigos"');
    expect(csvText('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvText('simple')).toBe('simple');
  });

  it('neutraliza fórmulas y saltos de línea', () => {
    expect(csvText('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(csvText('+54 11')).toBe("'+54 11");
    expect(csvText('@usuario')).toBe("'@usuario");
    expect(csvText('línea 1\nlínea 2')).toBe('línea 1 línea 2');
  });
});

describe('movementsToCSV', () => {
  const src = {
    accounts: [
      { id: 'a1', name: 'Galicia', type: 'bank' as const, currency: 'ARS' as const, initialBalance: 0, archived: false },
      { id: 'a2', name: 'Dólares', type: 'cash' as const, currency: 'USD' as const, initialBalance: 0, archived: false },
    ],
    categories: [
      { id: 'c1', name: 'Comida', kind: 'expense' as const },
      { id: 'c2', name: 'Super', kind: 'expense' as const, parentId: 'c1' },
    ],
    cards: [{ id: 'k1', name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false }],
    statements: [],
    purchases: [{ id: 'u1', cardId: 'k1', date: '2026-10-15', description: 'TV; 55"', categoryId: 'c1', currency: 'ARS' as const, installments: 2, amountMode: 'total' as const, totalAmount: 1000, startInstallment: 1, isRefund: false }],
    installments: [
      { id: 'i1', purchaseId: 'u1', cardId: 'k1', number: 1, of: 2, period: '2026-11', amount: 50_050, currency: 'ARS' as const, categoryId: 'c1', status: 'scheduled' as const },
      { id: 'i2', purchaseId: 'u1', cardId: 'k1', number: 2, of: 2, period: '2026-12', amount: 50_000, currency: 'ARS' as const, categoryId: 'c1', status: 'cancelled' as const },
    ],
    transactions: [
      { id: 't2', type: 'transfer' as const, accountId: 'a1', toAccountId: 'a2', amount: 120_000, toAmount: 100, date: '2026-10-20', description: 'Compra USD' },
      { id: 't1', type: 'expense' as const, accountId: 'a1', amount: 123_456, date: '2026-10-10', description: '=cmd', categoryId: 'c2' },
    ],
  };

  it('arma el CSV: BOM, encabezado, orden por fecha, montos con coma, cuotas en el vencimiento y sin canceladas', () => {
    const lines = movementsToCSV(src).replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Fecha;Tipo;Descripción;Categoría;Cuenta o tarjeta;Cuenta destino;Monto;Moneda;Monto destino;Moneda destino;Cuota');
    expect(lines.slice(1)).toEqual([
      "2026-10-10;Gasto;'=cmd;Comida > Super;Galicia;;1234,56;ARS;;;",
      '2026-10-20;Transferencia;Compra USD;;Galicia;Dólares;1200,00;ARS;1,00;USD;',
      '2026-11-20;Cuota de tarjeta;"TV; 55""";Comida;Visa;;500,50;ARS;;;1/2',
    ]);
    expect(movementsToCSV(src).startsWith('﻿')).toBe(true);
  });

  it('sin movimientos queda solo el encabezado', () => {
    expect(movementsToCSV({ ...src, transactions: [], installments: [] }).trimEnd().split('\r\n')).toHaveLength(1);
  });
});
