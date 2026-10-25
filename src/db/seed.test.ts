import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { today } from '../domain/dates';
import { FinanzasDB, SETTINGS_ID } from './schema';
import { CARD_PAYMENT_CATEGORY_ID, seedIfEmpty } from './seed';

let database: FinanzasDB;

afterEach(async () => {
  await database.delete();
});

describe('seedIfEmpty', () => {
  it('carga categorías de gasto, ingreso, la especial de pago de tarjeta y settings', async () => {
    database = new FinanzasDB(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(database);

    expect(await database.categories.where('kind').equals('expense').count()).toBe(16);
    expect(await database.categories.where('kind').equals('income').count()).toBe(4);
    expect((await database.categories.get(CARD_PAYMENT_CATEGORY_ID))?.name).toBe('Pago de tarjeta');
    expect(await database.settings.get(SETTINGS_ID)).toEqual({ id: SETTINGS_ID, firstDayOfWeek: 1, installedAt: today() });
  });

  it('es idempotente y no pisa datos del usuario', async () => {
    database = new FinanzasDB(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(database);
    await database.settings.update(SETTINGS_ID, { usdRate: 1200 });
    await seedIfEmpty(database);

    expect(await database.categories.count()).toBe(20);
    expect((await database.settings.get(SETTINGS_ID))?.usdRate).toBe(1200);
  });

  it('índice compuesto [cardId+period] de cuotas', async () => {
    database = new FinanzasDB(`test-${crypto.randomUUID()}`);
    await database.installments.bulkAdd([
      { id: 'a', purchaseId: 'p', cardId: 'visa', number: 1, of: 2, period: '2026-11', amount: 100, currency: 'ARS', categoryId: 'c', status: 'scheduled' },
      { id: 'b', purchaseId: 'p', cardId: 'visa', number: 2, of: 2, period: '2026-12', amount: 100, currency: 'ARS', categoryId: 'c', status: 'scheduled' },
      { id: 'c', purchaseId: 'q', cardId: 'master', number: 1, of: 1, period: '2026-11', amount: 50, currency: 'ARS', categoryId: 'c', status: 'scheduled' },
    ]);

    const visaNov = await database.installments.where('[cardId+period]').equals(['visa', '2026-11']).toArray();
    expect(visaNov.map((i) => i.id)).toEqual(['a']);
    expect(await database.installments.where('period').equals('2026-11').count()).toBe(2);
  });
});

describe('migración del esquema', () => {
  it('una base creada con la versión 1 abre con la versión 2 sin perder datos', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const { default: Dexie } = await import('dexie');
    const v1 = new Dexie(name);
    v1.version(1).stores({
      statementPayments: 'id, statementId',
      transactions: 'id, date, accountId, toAccountId, categoryId, statementPaymentId, recurringId',
    });
    await v1.table('statementPayments').add({ id: 'p', statementId: 's', accountId: 'a', date: '2026-11-18', amountARS: 100, amountUSD: 0 });
    v1.close();

    database = new FinanzasDB(name);
    expect((await database.statementPayments.get('p'))?.amountARS).toBe(100);
    await database.statementPayments.add({ id: 'q', statementId: 's', accountId: 'a', date: '2026-11-18', amountARS: 1, amountUSD: 0, groupId: 'g' });
    expect((await database.statementPayments.where('groupId').equals('g').toArray()).map((p) => p.id)).toEqual(['q']);
  });
});

describe('installedAt', () => {
  it('una base vieja sin installedAt lo recibe sin perder el resto de los ajustes', async () => {
    database = new FinanzasDB(`test-${crypto.randomUUID()}`);
    await database.settings.add({ id: SETTINGS_ID, firstDayOfWeek: 0, usdRate: 900 });
    await seedIfEmpty(database);
    expect(await database.settings.get(SETTINGS_ID)).toEqual({ id: SETTINGS_ID, firstDayOfWeek: 0, usdRate: 900, installedAt: today() });
  });
});
