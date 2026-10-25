// Modelo de datos (SPEC §3). Montos en centavos enteros; fechas 'YYYY-MM-DD'; períodos 'YYYY-MM'.

export type Currency = 'ARS' | 'USD';

export interface Account {
  id: string;
  name: string;
  type: 'bank' | 'cash' | 'wallet' | 'investment';
  currency: Currency;
  initialBalance: number;
  archived: boolean;
  color?: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  parentId?: string;
  icon?: string;
  color?: string;
}

export interface Transaction {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  accountId: string;
  toAccountId?: string;
  amount: number;
  toAmount?: number;
  date: string;
  categoryId?: string;
  description: string;
  statementPaymentId?: string;
  recurringId?: string;
}

export interface Card {
  id: string;
  name: string;
  limit?: number;
  defaultClosingDay: number;
  defaultDueDay: number;
  defaultPaymentAccountId?: string;
  archived: boolean;
  color?: string;
}

export interface Statement {
  id: string;
  cardId: string;
  period: string;
  closingDate: string;
  dueDate: string;
}

export interface CardPurchase {
  id: string;
  cardId: string;
  date: string;
  description: string;
  categoryId: string;
  currency: Currency;
  installments: number;
  amountMode: 'total' | 'perInstallment';
  totalAmount: number;
  installmentAmount?: number;
  startInstallment: number;
  firstPeriodOverride?: string;
  isRefund: boolean;
  recurringId?: string;
}

export interface Installment {
  id: string;
  purchaseId: string;
  cardId: string;
  number: number;
  of: number;
  period: string;
  amount: number;
  currency: Currency;
  categoryId: string;
  status: 'scheduled' | 'cancelled';
}

export interface StatementPayment {
  id: string;
  statementId: string;
  accountId: string;
  date: string;
  amountARS: number;
  amountUSD: number;
  exchangeRate?: number;
  /** Un pago que cubre varios resúmenes (el vencido y el actual) se guarda en una fila por resumen, con el mismo groupId y un único movimiento de cuenta. */
  groupId?: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  month: string;
  amount: number;
}

export interface Recurring {
  id: string;
  kind: 'transaction' | 'cardPurchase';
  template: Partial<Transaction> | Partial<CardPurchase>;
  frequency: 'monthly' | 'weekly' | 'yearly';
  dayOfMonth?: number;
  startDate: string;
  endDate?: string;
  lastGenerated?: string;
}

export interface Settings {
  usdRate?: number;
  firstDayOfWeek: 0 | 1;
}
