import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { statementSummary } from '../domain/cards';
import { saveAccount, saveTransaction, deleteTransaction, ValidationError } from './repo';
import { saveCard, savePurchase } from './cardsRepo';
import { deleteStatementPayment, payStatement } from './paymentsRepo';
import { FinanzasDB } from './schema';
import { CARD_PAYMENT_CATEGORY_ID } from './seed';

let database: FinanzasDB;
let card: string;
let pesos: string;
let dolares: string;

const NOV = '2026-10-20'; // cae en 2026-11 (cierre día 10)
const buy = (extra: Record<string, unknown> = {}) =>
  savePurchase(database, {
    cardId: card, date: NOV, description: 'Compra', categoryId: 'c', currency: 'ARS', installments: 2,
    amountMode: 'total', totalAmount: 200_000, startInstallment: 1, isRefund: false, ...extra,
  });

async function summary(period: string, today: string) {
  const c = (await database.cards.get(card))!;
  return statementSummary(
    c,
    await database.statements.where('cardId').equals(card).toArray(),
    await database.installments.toArray(),
    await database.statementPayments.toArray(),
    period,
    today,
  );
}

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  card = await saveCard(database, { name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false });
  pesos = await saveAccount(database, { name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 1_000_000, archived: false });
  dolares = await saveAccount(database, { name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 100_000, archived: false });
});

afterEach(async () => {
  await database.delete();
});

describe('payStatement', () => {
  it('pago total: crea el pago, el movimiento en la cuenta y deja el resumen pagado', async () => {
    await buy(); // Nov 100.000 + Dic 100.000
    const { transactionId, paymentIds } = await payStatement(
      database,
      { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 100_000, amountUSD: 0 },
      '2026-11-18',
    );
    expect(paymentIds).toHaveLength(1);

    const tx = (await database.transactions.get(transactionId))!;
    expect(tx).toMatchObject({ type: 'expense', accountId: pesos, amount: 100_000, categoryId: CARD_PAYMENT_CATEGORY_ID, statementPaymentId: paymentIds[0], date: '2026-11-18' });
    expect(await summary('2026-11', '2026-11-25')).toMatchObject({ paidARS: 100_000, remainingARS: 0, status: 'paid' });
  });

  it('pago parcial: queda saldo y el estado es parcial', async () => {
    await buy();
    await payStatement(database, { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 30_000, amountUSD: 0 }, '2026-11-18');
    expect(await summary('2026-11', '2026-11-19')).toMatchObject({ paidARS: 30_000, remainingARS: 70_000, status: 'partial' });
  });

  it('no deja pagar de más ni sin monto ni sin cuenta, y no guarda nada', async () => {
    await buy();
    const base = { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 100_001, amountUSD: 0 };
    await expect(payStatement(database, base, '2026-11-18')).rejects.toBeInstanceOf(ValidationError);
    await expect(payStatement(database, { ...base, amountARS: 0 }, '2026-11-18')).rejects.toBeInstanceOf(ValidationError);
    await expect(payStatement(database, { ...base, amountARS: 1, accountId: 'nada' }, '2026-11-18')).rejects.toBeInstanceOf(ValidationError);
    expect(await database.statementPayments.count()).toBe(0);
    expect(await database.transactions.count()).toBe(0);
  });

  it('el saldo vencido se arrastra y se paga junto con el resumen siguiente, en un solo movimiento', async () => {
    await buy(); // Nov 100.000 (vence 20/11), Dic 100.000 (vence 20/12)
    await payStatement(database, { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 40_000, amountUSD: 0 }, '2026-11-18');
    expect((await summary('2026-12', '2026-12-21')).previousBalanceARS).toBe(60_000);

    // total a pagar en diciembre: 100.000 propios + 60.000 vencidos
    const { transactionId, paymentIds } = await payStatement(
      database,
      { cardId: card, period: '2026-12', accountId: pesos, date: '2026-12-21', amountARS: 160_000, amountUSD: 0 },
      '2026-12-21',
    );
    expect(paymentIds).toHaveLength(2);
    expect(await database.transactions.count()).toBe(2); // 40.000 de antes y este
    expect((await database.transactions.get(transactionId))?.amount).toBe(160_000);

    const nov = await summary('2026-11', '2026-12-21');
    const dic = await summary('2026-12', '2026-12-21');
    expect(nov).toMatchObject({ remainingARS: 0, status: 'paid' });
    expect(dic).toMatchObject({ previousBalanceARS: 0, paidARS: 100_000, remainingARS: 0, status: 'paid' });
  });

  it('dólares con una cuenta en pesos: usa la cotización y descuenta pesos', async () => {
    await buy({ currency: 'USD', totalAmount: 20_000, installments: 1 }); // US$ 200,00
    const { transactionId } = await payStatement(
      database,
      { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 0, amountUSD: 20_000, exchangeRate: 1_250.5 },
      '2026-11-18',
    );
    expect((await database.transactions.get(transactionId))?.amount).toBe(25_010_000);
    expect((await database.statementPayments.toArray())[0]).toMatchObject({ amountUSD: 20_000, amountARS: 0, exchangeRate: 1_250.5 });
    expect(await summary('2026-11', '2026-11-25')).toMatchObject({ remainingUSD: 0, status: 'paid' });
  });

  it('dólares desde una cuenta en dólares: sin cotización, descuenta dólares', async () => {
    await buy({ currency: 'USD', totalAmount: 20_000, installments: 1 });
    const { transactionId } = await payStatement(
      database,
      { cardId: card, period: '2026-11', accountId: dolares, date: '2026-11-18', amountARS: 0, amountUSD: 20_000 },
      '2026-11-18',
    );
    expect(await database.transactions.get(transactionId)).toMatchObject({ accountId: dolares, amount: 20_000 });
    expect((await database.statementPayments.toArray())[0]!.exchangeRate).toBeUndefined();
  });

  it('pesos y dólares juntos desde una cuenta en pesos', async () => {
    await buy({ installments: 1, totalAmount: 50_000 });
    await buy({ currency: 'USD', totalAmount: 1_000, installments: 1 });
    const { transactionId } = await payStatement(
      database,
      { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 50_000, amountUSD: 1_000, exchangeRate: 1_000 },
      '2026-11-18',
    );
    expect((await database.transactions.get(transactionId))?.amount).toBe(50_000 + 1_000_000);
  });
});

describe('deshacer un pago', () => {
  it('borrar el pago borra todas sus filas y el movimiento', async () => {
    await buy();
    const { paymentIds } = await payStatement(database, { cardId: card, period: '2026-12', accountId: pesos, date: '2026-12-21', amountARS: 150_000, amountUSD: 0 }, '2026-12-21');
    expect(paymentIds).toHaveLength(2);
    await deleteStatementPayment(database, paymentIds[0]!);
    expect(await database.statementPayments.count()).toBe(0);
    expect(await database.transactions.count()).toBe(0);
    expect((await summary('2026-11', '2026-12-21')).status).toBe('overdue');
  });

  it('borrar el movimiento desde Movimientos también deshace el pago', async () => {
    await buy();
    const { transactionId } = await payStatement(database, { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 100_000, amountUSD: 0 }, '2026-11-18');
    await deleteTransaction(database, transactionId);
    expect(await database.statementPayments.count()).toBe(0);
    expect((await summary('2026-11', '2026-11-25')).remainingARS).toBe(100_000);
  });

  it('el movimiento de un pago no se puede editar', async () => {
    await buy();
    const { transactionId } = await payStatement(database, { cardId: card, period: '2026-11', accountId: pesos, date: '2026-11-18', amountARS: 100_000, amountUSD: 0 }, '2026-11-18');
    const tx = (await database.transactions.get(transactionId))!;
    await expect(saveTransaction(database, { ...tx, amount: 1 })).rejects.toThrow('no se editan');
  });
});
