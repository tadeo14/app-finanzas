// Exportación de movimientos a CSV para planillas. Separador ";" y coma decimal (como espera Excel/Sheets en es-AR).
import { resolveStatement } from './cards';
import { formatDecimal } from './money';
import type { Account, Card, CardPurchase, Category, Installment, Statement, Transaction } from './types';

const HEADER = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Cuenta o tarjeta', 'Cuenta destino', 'Monto', 'Moneda', 'Monto destino', 'Moneda destino', 'Cuota'];

/**
 * Celda de texto. Se entrecomilla si hace falta y, si empieza con = + - @ (o control), se antepone
 * un apóstrofe para que la planilla no lo interprete como fórmula.
 */
export function csvText(value: string): string {
  let text = value.replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CsvSources {
  transactions: readonly Transaction[];
  installments: readonly Installment[];
  purchases: readonly CardPurchase[];
  cards: readonly Card[];
  statements: readonly Statement[];
  accounts: readonly Account[];
  categories: readonly Category[];
}

/**
 * Todos los movimientos, del más viejo al más nuevo: los de cuentas por su fecha y las cuotas de tarjeta
 * por el vencimiento de su resumen (igual que en la lista de Movimientos). El monto de las transferencias
 * y de los gastos e ingresos es siempre positivo y el tipo dice qué es; una cuota negativa es una devolución.
 */
export function movementsToCSV(src: CsvSources): string {
  const account = new Map(src.accounts.map((a) => [a.id, a]));
  const card = new Map(src.cards.map((c) => [c.id, c]));
  const purchase = new Map(src.purchases.map((p) => [p.id, p]));
  const category = new Map(src.categories.map((c) => [c.id, c]));
  const categoryPath = (id?: string) => {
    const c = id ? category.get(id) : undefined;
    if (!c) return '';
    const parent = c.parentId ? category.get(c.parentId) : undefined;
    return parent ? `${parent.name} > ${c.name}` : c.name;
  };

  const rows: { date: string; order: number; cells: string[] }[] = [];

  for (const tx of src.transactions) {
    const from = account.get(tx.accountId);
    const to = tx.toAccountId ? account.get(tx.toAccountId) : undefined;
    const crossAmount = tx.type === 'transfer' ? (tx.toAmount ?? tx.amount) : undefined;
    rows.push({
      date: tx.date,
      order: 0,
      cells: [
        tx.date,
        { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia' }[tx.type],
        csvText(tx.description),
        csvText(categoryPath(tx.categoryId)),
        csvText(from?.name ?? ''),
        csvText(to?.name ?? ''),
        formatDecimal(tx.amount),
        from?.currency ?? '',
        crossAmount === undefined ? '' : formatDecimal(crossAmount),
        to?.currency ?? '',
        '',
      ],
    });
  }

  for (const i of src.installments) {
    if (i.status !== 'scheduled') continue;
    const c = card.get(i.cardId);
    const date = c ? resolveStatement(c, src.statements, i.period).dueDate : `${i.period}-01`;
    rows.push({
      date,
      order: 1,
      cells: [
        date, 'Cuota de tarjeta', csvText(purchase.get(i.purchaseId)?.description ?? ''), csvText(categoryPath(i.categoryId)),
        csvText(c?.name ?? ''), '', formatDecimal(i.amount), i.currency, '', '', `${i.number}/${i.of}`,
      ],
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  // BOM para que Excel detecte UTF-8 (tildes y ñ).
  return `﻿${[HEADER, ...rows.map((r) => r.cells)].map((cells) => cells.join(';')).join('\r\n')}\r\n`;
}
