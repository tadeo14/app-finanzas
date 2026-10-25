import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advancePurchase,
  deletePurchase,
  ensureStatement,
  saveCard,
  savePurchase,
  saveStatementDates,
  deleteCard,
  type PurchaseDraft,
} from './cardsRepo';
import { ValidationError } from './repo';
import { FinanzasDB } from './schema';

let database: FinanzasDB;
let cardId: string;

const draft = (extra: Partial<PurchaseDraft> = {}): PurchaseDraft => ({
  cardId,
  date: '2026-10-20',
  description: ' TV ',
  categoryId: 'tec',
  currency: 'ARS',
  installments: 3,
  amountMode: 'total',
  totalAmount: 10_000_000,
  startInstallment: 1,
  isRefund: false,
  ...extra,
});

const periodsOf = async (purchaseId: string, status: 'scheduled' | 'cancelled' = 'scheduled') =>
  (await database.installments.where('purchaseId').equals(purchaseId).toArray())
    .filter((i) => i.status === status)
    .sort((a, b) => a.number - b.number || a.period.localeCompare(b.period))
    .map((i) => `${i.number}@${i.period}`);

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  cardId = await saveCard(database, { name: ' Visa ', defaultClosingDay: 10, defaultDueDay: 20, archived: false });
});

afterEach(async () => {
  await database.delete();
});

describe('tarjetas', () => {
  it('valida días y límite', async () => {
    await expect(saveCard(database, { name: '', defaultClosingDay: 0, defaultDueDay: 32, limit: -1, archived: false })).rejects.toMatchObject({
      errors: expect.arrayContaining([expect.stringContaining('nombre'), expect.stringContaining('cierre'), expect.stringContaining('vencimiento'), expect.stringContaining('límite')]),
    });
  });

  it('no borra una tarjeta con compras', async () => {
    await savePurchase(database, draft());
    await expect(deleteCard(database, cardId)).rejects.toThrow('archivala');
  });

  it('borra una tarjeta sin compras junto con sus resúmenes', async () => {
    await ensureStatement(database, cardId, '2026-11');
    await deleteCard(database, cardId);
    expect(await database.cards.count()).toBe(0);
    expect(await database.statements.count()).toBe(0);
  });
});

describe('ensureStatement', () => {
  it('crea con las fechas por defecto una sola vez', async () => {
    const a = await ensureStatement(database, cardId, '2026-11');
    const b = await ensureStatement(database, cardId, '2026-11');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ closingDate: '2026-11-10', dueDate: '2026-11-20' });
    expect(await database.statements.count()).toBe(1);
  });
});

describe('compras', () => {
  it('genera las cuotas en los resúmenes correctos y recorta la descripción', async () => {
    const { id, firstPeriod } = await savePurchase(database, draft());
    expect(firstPeriod).toBe('2026-11');
    expect(await periodsOf(id)).toEqual(['1@2026-11', '2@2026-12', '3@2027-01']);
    expect((await database.cardPurchases.get(id))?.description).toBe('TV');
    const amounts = (await database.installments.where('purchaseId').equals(id).toArray()).sort((a, b) => a.number - b.number).map((i) => i.amount);
    expect(amounts).toEqual([3_333_334, 3_333_333, 3_333_333]);
  });

  it('modo por cuota guarda total = cuota × N', async () => {
    const { id } = await savePurchase(database, draft({ amountMode: 'perInstallment', installmentAmount: 1_000, totalAmount: 0 }));
    expect((await database.cardPurchases.get(id))?.totalAmount).toBe(3_000);
  });

  it('rechaza compras inválidas sin guardar nada', async () => {
    await expect(savePurchase(database, draft({ installments: 0 }))).rejects.toBeInstanceOf(ValidationError);
    await expect(savePurchase(database, draft({ cardId: 'fantasma' }))).rejects.toBeInstanceOf(ValidationError);
    expect(await database.cardPurchases.count()).toBe(0);
    expect(await database.installments.count()).toBe(0);
  });

  it('editar regenera las cuotas y cambiar la categoría la cambia en todas', async () => {
    const { id } = await savePurchase(database, draft());
    await savePurchase(database, draft({ id, installments: 2, totalAmount: 5_000, categoryId: 'ropa' }));
    const items = await database.installments.where('purchaseId').equals(id).toArray();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.categoryId === 'ropa')).toBe(true);
    expect(await database.cardPurchases.count()).toBe(1);
  });

  it('borrar la compra borra sus cuotas', async () => {
    const { id } = await savePurchase(database, draft());
    await deletePurchase(database, id);
    expect(await database.installments.count()).toBe(0);
    expect(await database.cardPurchases.count()).toBe(0);
  });

  it('usa las fechas editadas de los resúmenes', async () => {
    await saveStatementDates(database, cardId, '2026-10', '2026-10-25', '2026-11-05');
    const { firstPeriod } = await savePurchase(database, draft({ date: '2026-10-20' }));
    expect(firstPeriod).toBe('2026-10');
  });
});

describe('editar fechas de un resumen reubica las compras', () => {
  it('mueve las cuotas de las compras afectadas y deja las demás', async () => {
    const moves = (await savePurchase(database, draft({ date: '2026-10-12' }))).id; // cae en 2026-11
    const stays = (await savePurchase(database, draft({ date: '2026-10-01', installments: 1 }))).id; // cae en 2026-10
    expect(await periodsOf(moves)).toEqual(['1@2026-11', '2@2026-12', '3@2027-01']);

    await saveStatementDates(database, cardId, '2026-10', '2026-10-15', '2026-10-25');

    expect(await periodsOf(moves)).toEqual(['1@2026-10', '2@2026-11', '3@2026-12']);
    expect(await periodsOf(stays)).toEqual(['1@2026-10']);

    // y se puede volver atrás
    await saveStatementDates(database, cardId, '2026-10', '2026-10-10', '2026-10-20');
    expect(await periodsOf(moves)).toEqual(['1@2026-11', '2@2026-12', '3@2027-01']);
  });

  it('valida las fechas', async () => {
    await expect(saveStatementDates(database, cardId, '2026-10', '2026-10-30', '2026-10-20')).rejects.toThrow('anterior');
    await expect(saveStatementDates(database, cardId, '2026-10', '2026-02-30', '2026-10-20')).rejects.toThrow('válidas');
    expect(await database.statements.count()).toBe(0);
  });
});

describe('adelanto', () => {
  it('cancela las futuras y crea una cuota por la suma', async () => {
    const { id } = await savePurchase(database, draft({ installments: 6, totalAmount: 60_000 }));
    await advancePurchase(database, id, '2026-12');

    expect(await periodsOf(id, 'cancelled')).toEqual(['3@2027-01', '4@2027-02', '5@2027-03', '6@2027-04']);
    expect(await periodsOf(id)).toEqual(['1@2026-11', '2@2026-12', '6@2026-12']);
    const scheduled = (await database.installments.where('purchaseId').equals(id).toArray()).filter((i) => i.status === 'scheduled');
    expect(scheduled.reduce((s, i) => s + i.amount, 0)).toBe(60_000);
  });

  it('error si no queda nada por adelantar, sin tocar nada', async () => {
    const { id } = await savePurchase(database, draft({ installments: 2, totalAmount: 100 }));
    await expect(advancePurchase(database, id, '2026-12')).rejects.toBeInstanceOf(ValidationError);
    expect(await periodsOf(id, 'cancelled')).toEqual([]);
  });
});
