// Escrituras sobre la base. Validan con las funciones de dominio antes de guardar.
import { validateTransaction } from '../domain/accounts';
import type { Account, Transaction } from '../domain/types';
import type { FinanzasDB } from './schema';

export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'ValidationError';
  }
}

export type AccountDraft = Omit<Account, 'id'> & { id?: string };
export type TransactionDraft = Omit<Transaction, 'id'> & { id?: string };

export async function saveAccount(database: FinanzasDB, draft: AccountDraft): Promise<string> {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Poné un nombre.');
  if (!Number.isSafeInteger(draft.initialBalance)) errors.push('El saldo inicial no es válido.');
  if (errors.length) throw new ValidationError(errors);

  const account: Account = { ...draft, name: draft.name.trim(), id: draft.id ?? crypto.randomUUID() };
  if (draft.id) {
    const previous = await database.accounts.get(draft.id);
    // Cambiar la moneda de una cuenta con movimientos rompería sus saldos.
    if (previous && previous.currency !== account.currency && (await countAccountTransactions(database, draft.id)) > 0) {
      throw new ValidationError(['No se puede cambiar la moneda de una cuenta que ya tiene movimientos.']);
    }
  }
  await database.accounts.put(account);
  return account.id;
}

export function countAccountTransactions(database: FinanzasDB, accountId: string): Promise<number> {
  return database.transactions
    .where('accountId')
    .equals(accountId)
    .or('toAccountId')
    .equals(accountId)
    .count();
}

/** Solo se borran cuentas sin movimientos; las demás se archivan para no perder historia. */
export async function deleteAccount(database: FinanzasDB, accountId: string): Promise<void> {
  await database.transaction('rw', database.accounts, database.transactions, async () => {
    if ((await countAccountTransactions(database, accountId)) > 0) {
      throw new ValidationError(['La cuenta tiene movimientos: archivala en vez de borrarla.']);
    }
    await database.accounts.delete(accountId);
  });
}

export async function saveTransaction(database: FinanzasDB, draft: TransactionDraft): Promise<string> {
  const clean: TransactionDraft = { ...draft, description: draft.description.trim() };
  if (clean.type !== 'transfer') {
    delete clean.toAccountId;
    delete clean.toAmount;
  } else {
    delete clean.categoryId;
  }

  const accounts = await database.accounts.toArray();
  if (clean.type === 'transfer') {
    // toAmount solo tiene sentido entre monedas distintas
    const from = accounts.find((a) => a.id === clean.accountId);
    const to = accounts.find((a) => a.id === clean.toAccountId);
    if (from && to && from.currency === to.currency) delete clean.toAmount;
  }

  const errors = validateTransaction(clean, accounts);
  if (errors.length) throw new ValidationError(errors);

  const transaction: Transaction = { ...clean, id: clean.id ?? crypto.randomUUID() };
  await database.transactions.put(transaction);
  return transaction.id;
}

export async function deleteTransaction(database: FinanzasDB, transactionId: string): Promise<void> {
  await database.transactions.delete(transactionId);
}
