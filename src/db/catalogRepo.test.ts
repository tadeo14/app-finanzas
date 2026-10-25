import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteBudget, deleteCategory, saveBudget, saveCategory, saveUsdRate } from './catalogRepo';
import { saveCard, savePurchase } from './cardsRepo';
import { saveAccount, saveTransaction } from './repo';
import { FinanzasDB, SETTINGS_ID } from './schema';
import { CARD_PAYMENT_CATEGORY_ID, seedIfEmpty } from './seed';

let database: FinanzasDB;
let comida: string;

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(database);
  comida = await saveCategory(database, { name: 'Comida', kind: 'expense' });
});

afterEach(async () => {
  await database.delete();
});

describe('presupuestos', () => {
  it('guarda uno por categoría y mes; volver a guardar lo reemplaza', async () => {
    await saveBudget(database, comida, 'default', 10_000);
    await saveBudget(database, comida, 'default', 15_000);
    await saveBudget(database, comida, '2026-12', 20_000);
    const all = await database.budgets.toArray();
    expect(all).toHaveLength(2);
    expect(all.find((b) => b.month === 'default')?.amount).toBe(15_000);
  });

  it('valida mes, monto y que la categoría sea de gastos', async () => {
    const sueldo = (await database.categories.where('kind').equals('income').first())!.id;
    await expect(saveBudget(database, comida, '2026-13', 1)).rejects.toThrow('mes');
    await expect(saveBudget(database, comida, 'default', 0)).rejects.toThrow('mayor a cero');
    await expect(saveBudget(database, sueldo, 'default', 100)).rejects.toThrow('gastos');
    await expect(saveBudget(database, 'nada', 'default', 100)).rejects.toThrow('gastos');
    expect(await database.budgets.count()).toBe(0);
  });

  it('borrar solo quita el de ese mes', async () => {
    await saveBudget(database, comida, 'default', 1);
    await saveBudget(database, comida, '2026-12', 2);
    await deleteBudget(database, comida, '2026-12');
    expect((await database.budgets.toArray()).map((b) => b.month)).toEqual(['default']);
  });
});

describe('categorías', () => {
  it('crea subcategorías del mismo tipo', async () => {
    const sub = await saveCategory(database, { name: ' Super ', kind: 'expense', parentId: comida });
    expect(await database.categories.get(sub)).toMatchObject({ name: 'Super', parentId: comida });
    await expect(saveCategory(database, { name: 'X', kind: 'income', parentId: comida })).rejects.toThrow('mismo tipo');
    await expect(saveCategory(database, { name: 'X', kind: 'expense', parentId: 'nada' })).rejects.toThrow('no existe');
  });

  it('rechaza nombres vacíos y duplicados en el mismo nivel, pero permite el mismo nombre en otro nivel', async () => {
    await expect(saveCategory(database, { name: '  ', kind: 'expense' })).rejects.toThrow('nombre');
    await expect(saveCategory(database, { name: 'comida', kind: 'expense' })).rejects.toThrow('Ya existe');
    await expect(saveCategory(database, { name: 'Comida', kind: 'expense', parentId: comida })).resolves.toBeTruthy();
  });

  it('no permite ciclos de padres', async () => {
    const sub = await saveCategory(database, { name: 'Super', kind: 'expense', parentId: comida });
    const subsub = await saveCategory(database, { name: 'Chino', kind: 'expense', parentId: sub });
    await expect(saveCategory(database, { id: comida, name: 'Comida', kind: 'expense', parentId: subsub })).rejects.toThrow('sí misma');
    await expect(saveCategory(database, { id: sub, name: 'Super', kind: 'expense', parentId: sub })).rejects.toThrow('sí misma');
  });

  it('la categoría del sistema no se edita ni se borra', async () => {
    await expect(saveCategory(database, { id: CARD_PAYMENT_CATEGORY_ID, name: 'Otra', kind: 'expense' })).rejects.toThrow('sistema');
    await expect(deleteCategory(database, CARD_PAYMENT_CATEGORY_ID)).rejects.toThrow('sistema');
  });

  it('se borra solo si no tiene subcategorías, movimientos ni presupuestos', async () => {
    const sub = await saveCategory(database, { name: 'Super', kind: 'expense', parentId: comida });
    await expect(deleteCategory(database, comida)).rejects.toThrow('subcategorías');

    const account = await saveAccount(database, { name: 'A', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false });
    await saveTransaction(database, { type: 'expense', accountId: account, amount: 1, date: '2026-10-10', description: '', categoryId: sub });
    await expect(deleteCategory(database, sub)).rejects.toThrow('movimientos');

    const libre = await saveCategory(database, { name: 'Libre', kind: 'expense' });
    await saveBudget(database, libre, 'default', 10);
    await expect(deleteCategory(database, libre)).rejects.toThrow('presupuestos');
    await deleteBudget(database, libre, 'default');
    await deleteCategory(database, libre);
    expect(await database.categories.get(libre)).toBeUndefined();
  });

  it('una categoría usada solo por cuotas de tarjeta tampoco se borra ni cambia de tipo', async () => {
    const card = await saveCard(database, { name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false });
    const tec = await saveCategory(database, { name: 'Tecno', kind: 'expense' });
    await savePurchase(database, {
      cardId: card, date: '2026-10-05', description: 'TV', categoryId: tec, currency: 'ARS', installments: 2,
      amountMode: 'total', totalAmount: 100, startInstallment: 1, isRefund: false,
    });
    await expect(deleteCategory(database, tec)).rejects.toThrow('movimientos');
    await expect(saveCategory(database, { id: tec, name: 'Tecno', kind: 'income' })).rejects.toThrow('cambiar');
  });

  it('no cambia el tipo de una categoría con movimientos', async () => {
    const account = await saveAccount(database, { name: 'A', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false });
    await saveTransaction(database, { type: 'expense', accountId: account, amount: 1, date: '2026-10-10', description: '', categoryId: comida });
    await expect(saveCategory(database, { id: comida, name: 'Comida', kind: 'income' })).rejects.toThrow('cambiar');
  });
});

describe('cotización', () => {
  it('guarda, valida y quita la cotización sin tocar el resto de los ajustes', async () => {
    await saveUsdRate(database, 1250.5);
    expect(await database.settings.get(SETTINGS_ID)).toEqual({ id: SETTINGS_ID, firstDayOfWeek: 1, usdRate: 1250.5 });
    await expect(saveUsdRate(database, 0)).rejects.toThrow('mayor a cero');
    await expect(saveUsdRate(database, Number.NaN)).rejects.toThrow('mayor a cero');
    await saveUsdRate(database, undefined);
    expect(await database.settings.get(SETTINGS_ID)).toEqual({ id: SETTINGS_ID, firstDayOfWeek: 1 });
  });
});
