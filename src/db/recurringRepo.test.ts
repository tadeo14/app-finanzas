import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveCard } from './cardsRepo';
import { deleteRecurring, generateDueRecurrings, saveRecurring, type RecurringDraft } from './recurringRepo';
import { deleteAccount, saveAccount, ValidationError } from './repo';
import { FinanzasDB } from './schema';

let database: FinanzasDB;
let account: string;
let card: string;

const sub = (extra: Partial<RecurringDraft> = {}): RecurringDraft => ({
  kind: 'transaction',
  template: { type: 'expense', accountId: account, amount: 1500, categoryId: 'serv', description: 'Internet' },
  frequency: 'monthly',
  startDate: '2026-08-10',
  ...extra,
});

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  account = await saveAccount(database, { name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 0, archived: false });
  card = await saveCard(database, { name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false });
});

afterEach(async () => {
  await database.delete();
});

describe('saveRecurring', () => {
  it('valida y guarda; dayOfMonth solo aplica a los mensuales', async () => {
    await expect(saveRecurring(database, sub({ startDate: '2026-02-30' }))).rejects.toBeInstanceOf(ValidationError);
    const id = await saveRecurring(database, sub({ frequency: 'weekly', dayOfMonth: 5 }));
    expect((await database.recurrings.get(id))?.dayOfMonth).toBeUndefined();
  });
});

describe('generateDueRecurrings', () => {
  it('al abrir genera las ocurrencias pendientes, vinculadas al recurrente, y avanza lastGenerated', async () => {
    const id = await saveRecurring(database, sub());
    const result = await generateDueRecurrings(database, '2026-10-25');
    expect(result).toEqual({ generated: 3, failures: [] });

    const txs = (await database.transactions.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(txs.map((t) => t.date)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10']);
    expect(txs.every((t) => t.recurringId === id && t.amount === 1500 && t.description === 'Internet' && t.accountId === account)).toBe(true);
    expect((await database.recurrings.get(id))?.lastGenerated).toBe('2026-10-10');
  });

  it('es idempotente: abrir de nuevo no duplica, y al mes siguiente genera solo la nueva', async () => {
    await saveRecurring(database, sub());
    await generateDueRecurrings(database, '2026-10-25');
    expect((await generateDueRecurrings(database, '2026-10-25')).generated).toBe(0);
    expect((await generateDueRecurrings(database, '2026-11-09')).generated).toBe(0);
    expect((await generateDueRecurrings(database, '2026-11-10')).generated).toBe(1);
    expect(await database.transactions.count()).toBe(4);
  });

  it('dos aperturas simultáneas no duplican', async () => {
    await saveRecurring(database, sub());
    const [a, b] = await Promise.all([generateDueRecurrings(database, '2026-10-25'), generateDueRecurrings(database, '2026-10-25')]);
    expect(a.generated + b.generated).toBe(3);
    expect(await database.transactions.count()).toBe(3);
  });

  it('respeta endDate y no genera antes del inicio', async () => {
    await saveRecurring(database, sub({ endDate: '2026-09-30' }));
    await saveRecurring(database, sub({ startDate: '2027-01-01', template: { type: 'income', accountId: account, amount: 1, categoryId: 'x' } }));
    await generateDueRecurrings(database, '2026-12-31');
    expect((await database.transactions.toArray()).map((t) => t.date).sort()).toEqual(['2026-08-10', '2026-09-10']);
  });

  it('una suscripción con tarjeta genera una compra de 1 cuota por mes, con su cuota en el resumen que corresponde', async () => {
    const id = await saveRecurring(
      database,
      sub({ kind: 'cardPurchase', template: { cardId: card, categoryId: 'sus', totalAmount: 5000, description: 'Spotify', installments: 6 } }),
    );
    expect((await generateDueRecurrings(database, '2026-10-25')).generated).toBe(3);

    const purchases = (await database.cardPurchases.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(purchases.map((p) => [p.date, p.installments, p.recurringId])).toEqual([
      ['2026-08-10', 1, id], ['2026-09-10', 1, id], ['2026-10-10', 1, id],
    ]);
    const periods = (await database.installments.toArray()).map((i) => i.period).sort();
    // cierre día 10: la compra del día 10 cae en el resumen de ese mes
    expect(periods).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('si la cuenta ya no existe no genera nada, informa y reintenta después', async () => {
    const id = await saveRecurring(database, sub());
    const other = await saveAccount(database, { name: 'Otra', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false });
    await saveRecurring(database, sub({ template: { type: 'expense', accountId: other, amount: 10, categoryId: 'x', description: 'Café' } }));
    await deleteAccount(database, account);

    const result = await generateDueRecurrings(database, '2026-10-25');
    expect(result.generated).toBe(3); // solo el de la cuenta que sigue existiendo
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ recurringId: id, description: 'Internet' });
    const failed = await database.recurrings.get(id);
    expect(failed?.lastGenerated).toBeUndefined();
    expect((await database.transactions.toArray()).every((t) => t.accountId === other)).toBe(true);

    // se arregla apuntando a otra cuenta y se completa en la siguiente apertura
    await saveRecurring(database, { ...failed!, template: { ...failed!.template, accountId: other } });
    expect((await generateDueRecurrings(database, '2026-10-25')).generated).toBe(3);
  });

  it('borrar la regla deja lo ya generado', async () => {
    const id = await saveRecurring(database, sub());
    await generateDueRecurrings(database, '2026-10-25');
    await deleteRecurring(database, id);
    expect(await database.recurrings.count()).toBe(0);
    expect(await database.transactions.count()).toBe(3);
  });
});
