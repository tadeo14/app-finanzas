import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_TABLES } from '../domain/backup';
import { backupFileName, exportBackup, exportMovementsCSV, importBackup, markBackup, parseBackup } from './backup';
import { saveBudget, saveCategory, saveUsdRate } from './catalogRepo';
import { advancePurchase, saveCard, savePurchase } from './cardsRepo';
import { payStatement } from './paymentsRepo';
import { generateDueRecurrings, saveRecurring } from './recurringRepo';
import { saveAccount, saveTransaction } from './repo';
import { FinanzasDB, SETTINGS_ID } from './schema';
import { seedIfEmpty } from './seed';

let source: FinanzasDB;
let target: FinanzasDB;

async function populate(database: FinanzasDB) {
  await seedIfEmpty(database);
  const comida = await saveCategory(database, { name: 'Comida', kind: 'expense' });
  const super_ = await saveCategory(database, { name: 'Super', kind: 'expense', parentId: comida });
  const pesos = await saveAccount(database, { name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 500_000, archived: false });
  const usd = await saveAccount(database, { name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 10_000, archived: false });
  await saveTransaction(database, { type: 'expense', accountId: pesos, amount: 12_345, date: '2026-10-08', description: 'Coto', categoryId: super_ });
  await saveTransaction(database, { type: 'transfer', accountId: pesos, toAccountId: usd, amount: 120_000, toAmount: 100, date: '2026-10-09', description: 'USD' });
  const card = await saveCard(database, { name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, limit: 1_000_000, archived: false });
  const { id: tv } = await savePurchase(database, {
    cardId: card, date: '2026-08-05', description: 'TV', categoryId: comida, currency: 'ARS', installments: 6,
    amountMode: 'total', totalAmount: 600_000, startInstallment: 1, isRefund: false,
  });
  await advancePurchase(database, tv, '2026-10');
  await payStatement(database, { cardId: card, period: '2026-10', accountId: pesos, date: '2026-10-18', amountARS: 150_000, amountUSD: 0 }, '2026-10-18');
  await saveBudget(database, comida, 'default', 50_000);
  await saveRecurring(database, { kind: 'transaction', template: { type: 'expense', accountId: pesos, amount: 1_500, categoryId: comida, description: 'Internet' }, frequency: 'monthly', startDate: '2026-09-10' });
  await generateDueRecurrings(database, '2026-10-25');
  await saveUsdRate(database, 1250.5);
}

const snapshot = async (database: FinanzasDB) =>
  Object.fromEntries(await Promise.all(BACKUP_TABLES.map(async (t) => [t, (await database.table(t).toArray()).sort((a, b) => String(a.id).localeCompare(String(b.id)))])));

beforeEach(() => {
  source = new FinanzasDB(`src-${crypto.randomUUID()}`);
  target = new FinanzasDB(`dst-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await source.delete();
  await target.delete();
});

describe('exportBackup / importBackup', () => {
  it('un backup exportado se valida y, importado en una base vacía, la deja idéntica', async () => {
    await populate(source);
    const file = await exportBackup(source, new Date('2026-10-25T15:00:00Z'));
    expect(file).toMatchObject({ app: 'finanzas-personales', format: 1, exportedAt: '2026-10-25T15:00:00.000Z' });

    // pasa por texto como en el archivo real
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await importBackup(target, parsed.backup);
    expect(await snapshot(target)).toEqual(await snapshot(source));
  });

  it('importar reemplaza lo que había', async () => {
    await populate(source);
    await seedIfEmpty(target);
    await saveAccount(target, { name: 'Vieja', type: 'cash', currency: 'ARS', initialBalance: 1, archived: false });
    const parsed = parseBackup(JSON.stringify(await exportBackup(source)));
    if (!parsed.ok) throw new Error('inválido');
    await importBackup(target, parsed.backup);
    expect((await target.accounts.toArray()).map((a) => a.name).sort()).toEqual(['Dólares', 'Galicia']);
  });

  it('las cuotas adelantadas, los pagos agrupados y los índices siguen funcionando después de importar', async () => {
    await populate(source);
    const parsed = parseBackup(JSON.stringify(await exportBackup(source)));
    if (!parsed.ok) throw new Error('inválido');
    await importBackup(target, parsed.backup);
    expect(await target.installments.filter((i) => i.status === 'cancelled').count()).toBe(3);
    const [card] = await target.cards.toArray();
    // el pago de 150.000 saldó Agosto y Septiembre (lo más viejo primero), que son los resúmenes guardados
    expect(await target.statements.where('[cardId+period]').equals([card!.id, '2026-08']).count()).toBe(1);
    expect(await target.statements.where('[cardId+period]').equals([card!.id, '2026-09']).count()).toBe(1);
    const payment = (await target.statementPayments.toArray())[0]!;
    expect(await target.statementPayments.where('groupId').equals(payment.groupId!).count()).toBeGreaterThan(0);
  });

  it('exportar anota la fecha del backup', async () => {
    await seedIfEmpty(source);
    await exportBackup(source, new Date('2026-10-25T15:00:00Z'));
    expect((await source.settings.get(SETTINGS_ID))?.lastBackupAt).toBe('2026-10-25');
  });

  it('el archivo exportado incluye la fecha del backup para que el recordatorio sobreviva a una restauración', async () => {
    await seedIfEmpty(source);
    const file = await exportBackup(source, new Date('2026-10-25T15:00:00Z'));
    expect(file.data.settings[0]).toMatchObject({ lastBackupAt: '2026-10-25' });
  });
});

describe('importar un archivo malo no toca nada', () => {
  it('JSON roto', () => {
    expect(parseBackup('{no es json')).toEqual({ ok: false, errors: ['El archivo no es un JSON válido.'] });
  });

  it('archivo inválido: se rechaza y los datos quedan como estaban', async () => {
    await populate(source);
    const before = await snapshot(source);
    const file = JSON.parse(JSON.stringify(await exportBackup(source)));
    file.data.transactions[0].accountId = 'cuenta-fantasma';
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(false);
    // aunque alguien saltee parseBackup, importBackup valida de nuevo
    await expect(importBackup(source, file)).rejects.toThrow('una cuenta que no existe');
    expect(await snapshot(source)).toEqual({ ...before, settings: await source.settings.toArray() });
  });

  it('si la escritura falla a mitad de camino, la transacción se deshace', async () => {
    await populate(source);
    const before = await snapshot(source);
    const file = JSON.parse(JSON.stringify(await exportBackup(source)));
    const parsed = parseBackup(JSON.stringify(file));
    if (!parsed.ok) throw new Error('inválido');
    // un id repetido en una tabla pasa la validación de referencias pero hace fallar bulkAdd: lo forzamos después de validar
    parsed.backup.data.budgets.push({ ...parsed.backup.data.budgets[0]! });
    await expect(importBackup(source, parsed.backup)).rejects.toThrow();
    expect(await snapshot(source)).toEqual({ ...before, settings: await source.settings.toArray() });
  });
});

describe('otros', () => {
  it('nombre del archivo con la fecha', () => {
    expect(backupFileName('2026-10-25')).toBe('finanzas-backup-2026-10-25.json');
  });

  it('markBackup no pisa el resto de los ajustes', async () => {
    await seedIfEmpty(source);
    await saveUsdRate(source, 900);
    await markBackup(source, '2026-10-20');
    expect(await source.settings.get(SETTINGS_ID)).toMatchObject({ usdRate: 900, lastBackupAt: '2026-10-20' });
  });

  it('exporta los movimientos a CSV con cuentas y cuotas', async () => {
    await populate(source);
    const csv = await exportMovementsCSV(source);
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0]).toContain('Fecha;Tipo');
    expect(lines.some((l) => l.includes('Gasto;Coto;Comida > Super;Galicia;;123,45;ARS'))).toBe(true);
    expect(lines.some((l) => l.includes('Transferencia;USD') && l.includes('1200,00;ARS;1,00;USD'))).toBe(true);
    expect(lines.some((l) => l.includes('Cuota de tarjeta;TV'))).toBe(true);
    expect(lines.some((l) => l.includes('Pago Visa'))).toBe(true);
  });
});
