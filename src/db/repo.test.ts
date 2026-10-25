import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanzasDB } from './schema';
import { deleteAccount, saveAccount, saveTransaction, ValidationError } from './repo';

let database: FinanzasDB;
let banco: string;
let usd: string;

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  banco = await saveAccount(database, { name: ' Banco ', type: 'bank', currency: 'ARS', initialBalance: 0, archived: false });
  usd = await saveAccount(database, { name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 0, archived: false });
});

afterEach(async () => {
  await database.delete();
});

describe('cuentas', () => {
  it('guarda con id generado y nombre recortado', async () => {
    expect((await database.accounts.get(banco))?.name).toBe('Banco');
  });

  it('nombre vacío es inválido', async () => {
    await expect(
      saveAccount(database, { name: '  ', type: 'cash', currency: 'ARS', initialBalance: 0, archived: false }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('no deja borrar ni cambiar moneda de una cuenta con movimientos', async () => {
    await saveTransaction(database, { type: 'transfer', accountId: banco, toAccountId: usd, amount: 100, toAmount: 1, date: '2026-10-10', description: '' });

    await expect(deleteAccount(database, usd)).rejects.toThrow('archivala');
    const account = (await database.accounts.get(banco))!;
    await expect(saveAccount(database, { ...account, currency: 'USD' })).rejects.toThrow('moneda');

    await saveAccount(database, { ...account, archived: true });
    expect((await database.accounts.get(banco))?.archived).toBe(true);
  });

  it('borra una cuenta sin movimientos', async () => {
    await deleteAccount(database, banco);
    expect(await database.accounts.get(banco)).toBeUndefined();
  });
});

describe('movimientos', () => {
  it('rechaza un movimiento inválido', async () => {
    await expect(
      saveTransaction(database, { type: 'expense', accountId: banco, amount: 0, date: '2026-10-10', description: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await database.transactions.count()).toBe(0);
  });

  it('limpia campos que no corresponden al tipo', async () => {
    const id = await saveTransaction(database, {
      type: 'expense', accountId: banco, toAccountId: usd, toAmount: 5, amount: 100, date: '2026-10-10', description: ' Coto ', categoryId: 'super',
    });
    const saved = (await database.transactions.get(id))!;
    expect(saved).toEqual({ id, type: 'expense', accountId: banco, amount: 100, date: '2026-10-10', description: 'Coto', categoryId: 'super' });
  });

  it('editar conserva el id', async () => {
    const id = await saveTransaction(database, { type: 'income', accountId: banco, amount: 100, date: '2026-10-10', description: '' });
    await saveTransaction(database, { id, type: 'income', accountId: banco, amount: 250, date: '2026-10-11', description: '' });
    expect(await database.transactions.count()).toBe(1);
    expect((await database.transactions.get(id))?.amount).toBe(250);
  });
});
