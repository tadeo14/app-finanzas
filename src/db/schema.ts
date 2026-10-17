// Base local en IndexedDB vía Dexie. Solo se declaran como índices los campos por los que se consulta.
import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  Budget,
  Card,
  CardPurchase,
  Category,
  Installment,
  Recurring,
  Settings,
  Statement,
  StatementPayment,
  Transaction,
} from '../domain/types';

/** Settings se guarda como una única fila con id fijo. */
export const SETTINGS_ID = 'app';
export type SettingsRow = Settings & { id: typeof SETTINGS_ID };

export class FinanzasDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  statements!: EntityTable<Statement, 'id'>;
  cardPurchases!: EntityTable<CardPurchase, 'id'>;
  installments!: EntityTable<Installment, 'id'>;
  statementPayments!: EntityTable<StatementPayment, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  recurrings!: EntityTable<Recurring, 'id'>;
  settings!: EntityTable<SettingsRow, 'id'>;

  constructor(name = 'finanzas') {
    super(name);
    this.version(1).stores({
      accounts: 'id',
      categories: 'id, kind, parentId',
      transactions: 'id, date, accountId, toAccountId, categoryId, statementPaymentId, recurringId',
      cards: 'id',
      statements: 'id, cardId, &[cardId+period]',
      cardPurchases: 'id, cardId, date, recurringId',
      installments: 'id, purchaseId, cardId, period, [cardId+period]',
      statementPayments: 'id, statementId',
      budgets: 'id, categoryId, month, &[categoryId+month]',
      recurrings: 'id',
      settings: 'id',
    });
  }
}

export const db = new FinanzasDB();
