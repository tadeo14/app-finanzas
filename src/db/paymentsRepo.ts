// Pago de resúmenes: crea las filas de StatementPayment y el movimiento de la cuenta en una sola transacción.
import { statementSummary } from '../domain/cards';
import { today } from '../domain/dates';
import { allocatePayment, paymentAccountAmount, validatePayment, type PaymentDraft } from '../domain/payments';
import type { StatementPayment, Transaction } from '../domain/types';
import { ensureStatement } from './cardsRepo';
import { ValidationError } from './errors';
import type { FinanzasDB } from './schema';
import { CARD_PAYMENT_CATEGORY_ID } from './seed';

export interface PayStatementInput extends PaymentDraft {
  cardId: string;
  period: string;
  accountId: string;
  date: string;
}

/**
 * Registra el pago de un resumen. Si hay resúmenes anteriores vencidos con deuda, el pago los salda
 * primero (una fila de StatementPayment por resumen, todas con el mismo groupId) y sale de la
 * cuenta un único movimiento, vinculado a la fila del último resumen cubierto.
 */
export async function payStatement(
  database: FinanzasDB,
  input: PayStatementInput,
  todayDate: string = today(),
): Promise<{ transactionId: string; paymentIds: string[] }> {
  return database.transaction(
    'rw',
    [database.cards, database.accounts, database.statements, database.installments, database.statementPayments, database.transactions],
    async () => {
      const [card, account] = await Promise.all([database.cards.get(input.cardId), database.accounts.get(input.accountId)]);
      if (!card) throw new ValidationError(['La tarjeta no existe.']);
      if (!account) throw new ValidationError(['Elegí la cuenta desde la que pagás.']);

      const [statements, installments, payments] = await Promise.all([
        database.statements.where('cardId').equals(card.id).toArray(),
        database.installments.where('cardId').equals(card.id).toArray(),
        database.statementPayments.toArray(),
      ]);

      const summary = statementSummary(card, statements, installments, payments, input.period, todayDate);
      const errors = validatePayment(input, account, summary);
      if (errors.length) throw new ValidationError(errors);

      const chunks = allocatePayment(card, statements, installments, payments, input.period, input.amountARS, input.amountUSD, todayDate);
      const groupId = crypto.randomUUID();
      const rows: StatementPayment[] = [];
      for (const chunk of chunks) {
        const statement = await ensureStatement(database, card.id, chunk.period);
        rows.push({
          id: crypto.randomUUID(),
          statementId: statement.id,
          accountId: account.id,
          date: input.date,
          amountARS: chunk.amountARS,
          amountUSD: chunk.amountUSD,
          exchangeRate: input.amountUSD > 0 && account.currency === 'ARS' ? input.exchangeRate : undefined,
          groupId,
        });
      }

      const transaction: Transaction = {
        id: crypto.randomUUID(),
        type: 'expense',
        accountId: account.id,
        amount: paymentAccountAmount(input, account),
        date: input.date,
        categoryId: CARD_PAYMENT_CATEGORY_ID,
        description: `Pago ${card.name}`,
        statementPaymentId: rows[rows.length - 1]!.id,
      };
      await database.statementPayments.bulkAdd(rows);
      await database.transactions.add(transaction);
      return { transactionId: transaction.id, paymentIds: rows.map((r) => r.id) };
    },
  );
}

/** Deshace un pago completo: todas sus filas y el movimiento de la cuenta. */
export async function deleteStatementPayment(database: FinanzasDB, paymentId: string): Promise<void> {
  await database.transaction('rw', database.statementPayments, database.transactions, async () => {
    const payment = await database.statementPayments.get(paymentId);
    if (!payment) return;
    const group = payment.groupId
      ? await database.statementPayments.where('groupId').equals(payment.groupId).toArray()
      : [payment];
    const ids = group.map((p) => p.id);
    await database.transactions.where('statementPaymentId').anyOf(ids).delete();
    await database.statementPayments.bulkDelete(ids);
  });
}
