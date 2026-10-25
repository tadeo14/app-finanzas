import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MonthSelector from '../components/MonthSelector';
import PageHeader from '../components/PageHeader';
import { inputClass } from '../components/ui';
import { groupByDay, signedAmountFor } from '../domain/accounts';
import { formatDate, periodOf, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { buildMovementRows, type MovementFilters, type MovementRow } from '../domain/movements';
import type { Account, Category, Transaction } from '../domain/types';
import { deletePurchase } from '../db/cardsRepo';
import { deleteTransaction } from '../db/repo';
import { db } from '../db/schema';
import { useAccounts, useCards, useCategories, useInstallments, usePurchases, useStatements, useTransactions } from '../hooks/useData';

const TYPE_LABEL: Record<NonNullable<MovementFilters['type']>, string> = {
  expense: 'Gastos',
  income: 'Ingresos',
  transfer: 'Transferencias',
  card: 'Cuotas de tarjeta',
};

// Mes y filtros se recuerdan mientras dure la sesión: al volver de editar un movimiento
// la lista tiene que quedar donde estaba, no saltar al mes actual.
const remembered: { month?: string; filters: Omit<MovementFilters, 'month'> } = { filters: {} };

export default function Movimientos() {
  const transactions = useTransactions();
  const installments = useInstallments();
  const purchases = usePurchases();
  const statements = useStatements();
  const accounts = useAccounts() ?? [];
  const cards = useCards() ?? [];
  const categories = useCategories();
  const [month, setMonthState] = useState(() => remembered.month ?? periodOf(today()));
  const [filters, setFiltersState] = useState(remembered.filters);
  const setMonth = (value: string) => {
    remembered.month = value;
    setMonthState(value);
  };
  const setFilters = (value: Omit<MovementFilters, 'month'>) => {
    remembered.filters = value;
    setFiltersState(value);
  };
  const [showFilters, setShowFilters] = useState(false);

  const rows = useMemo(
    () =>
      buildMovementRows(
        { transactions: transactions ?? [], installments: installments ?? [], purchases: purchases ?? [], cards, statements: statements ?? [], categories },
        { ...filters, month },
      ),
    [transactions, installments, purchases, cards, statements, categories, filters, month],
  );
  const groups = groupByDay(rows);
  const activeFilters = [filters.accountId, filters.cardId, filters.categoryId, filters.type].filter(Boolean).length;
  const loaded = transactions !== undefined && installments !== undefined;
  const nothingAtAll = loaded && transactions.length === 0 && installments.length === 0;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Movimientos" />
      <div className="space-y-3">
        <MonthSelector value={month} onChange={setMonth} />
        <div className="flex gap-2">
          <input type="search" className={inputClass} placeholder="Buscar…" value={filters.text ?? ''} onChange={(e) => setFilters({ ...filters, text: e.target.value || undefined })} />
          <button type="button" onClick={() => setShowFilters(!showFilters)}
            className={`shrink-0 rounded-xl border px-3 text-sm ${activeFilters ? 'border-emerald-600 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>
            Filtros{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-900 p-3">
            <select aria-label="Tipo" className={inputClass} value={filters.type ?? ''} onChange={(e) => setFilters({ ...filters, type: (e.target.value || undefined) as MovementFilters['type'] })}>
              <option value="">Todos los tipos</option>
              {Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label="Cuenta" className={inputClass} value={filters.accountId ?? ''} onChange={(e) => setFilters({ ...filters, accountId: e.target.value || undefined, cardId: undefined })}>
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>)}
            </select>
            <select aria-label="Tarjeta" className={inputClass} value={filters.cardId ?? ''} onChange={(e) => setFilters({ ...filters, cardId: e.target.value || undefined, accountId: undefined })}>
              <option value="">Todas las tarjetas</option>
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archivada)' : ''}</option>)}
            </select>
            <select aria-label="Categoría" className={inputClass} value={filters.categoryId ?? ''} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name} ({c.kind === 'income' ? 'ingreso' : 'gasto'})</option>)}
            </select>
            {activeFilters > 0 && (
              <button type="button" onClick={() => setFilters({ text: filters.text })} className="py-2 text-sm text-slate-400">Limpiar filtros</button>
            )}
          </div>
        )}

        {!loaded ? null : groups.length === 0 ? (
          <EmptyState>
            {nothingAtAll
              ? 'Todavía no cargaste movimientos. Tocá + para registrar un gasto, ingreso, transferencia o compra con tarjeta.'
              : 'No hay movimientos que coincidan en este mes.'}
          </EmptyState>
        ) : (
          groups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{formatDate(group.date)}</h2>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
                {group.items.map((row) =>
                  row.kind === 'transaction' ? (
                    <TransactionRow key={row.id} tx={row.transaction} accountById={accountById} categoryById={categoryById} filterAccountId={filters.accountId} />
                  ) : (
                    <InstallmentRow key={row.id} row={row} categoryById={categoryById} />
                  ),
                )}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function RowShell({ to, icon, title, subtitle, amount, amountClass, onDelete, deleteLabel }: {
  to: string; icon: string; title: string; subtitle: string; amount: string; amountClass: string; onDelete: () => void; deleteLabel: string;
}) {
  return (
    <li className="flex items-center">
      <Link to={to} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 active:bg-slate-800">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-lg">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-slate-500">{subtitle}</span>
        </span>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${amountClass}`}>{amount}</span>
      </Link>
      <button type="button" onClick={onDelete} aria-label={deleteLabel} className="px-3 py-3 text-slate-600 active:text-red-400">🗑</button>
    </li>
  );
}

function InstallmentRow({ row, categoryById }: { row: Extract<MovementRow, { kind: 'installment' }>; categoryById: Map<string, Category> }) {
  const { installment: i, purchase, card } = row;
  const category = categoryById.get(i.categoryId);
  const description = purchase?.description || category?.name || 'Compra con tarjeta';
  const title = i.of > 1 ? `${description} — cuota ${i.number}/${i.of}` : description;
  // Las cuotas guardan el monto con signo de la compra: positivo es gasto, negativo es devolución.
  const amount = -i.amount;

  async function handleDelete() {
    if (window.confirm(`¿Borrar la compra "${description}" y todas sus cuotas?`)) await deletePurchase(db, i.purchaseId);
  }

  return (
    <RowShell to={`/compras/${i.purchaseId}`} icon="💳" title={title} subtitle={[card?.name, category?.name].filter(Boolean).join(' · ')}
      amount={formatMoney(amount, i.currency)} amountClass={amount > 0 ? 'text-emerald-400' : ''} onDelete={handleDelete} deleteLabel={`Borrar compra ${description}`} />
  );
}

function TransactionRow({ tx, accountById, categoryById, filterAccountId }: {
  tx: Transaction; accountById: Map<string, Account>; categoryById: Map<string, Category>; filterAccountId?: string;
}) {
  const from = accountById.get(tx.accountId);
  const to = tx.toAccountId ? accountById.get(tx.toAccountId) : undefined;
  const category = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;

  // Filtrando por cuenta destino, la transferencia se ve como entrada en la moneda de esa cuenta.
  const incoming = tx.type === 'transfer' && filterAccountId !== undefined && filterAccountId === tx.toAccountId;
  const amount = incoming ? signedAmountFor(tx, filterAccountId) : tx.type === 'income' ? tx.amount : -tx.amount;
  const currency = (incoming ? to : from)?.currency ?? 'ARS';

  const title = tx.description || category?.name || (tx.type === 'transfer' ? 'Transferencia' : 'Sin descripción');
  const subtitle = tx.type === 'transfer' ? `${from?.name ?? '?'} → ${to?.name ?? '?'}` : [category?.name, from?.name].filter(Boolean).join(' · ');
  const color = tx.type === 'transfer' ? 'text-sky-300' : amount < 0 ? 'text-slate-100' : 'text-emerald-400';

  async function handleDelete() {
    if (window.confirm(`¿Borrar "${title}"?`)) await deleteTransaction(db, tx.id);
  }

  return (
    <RowShell to={`/movimientos/${tx.id}`} icon={tx.type === 'transfer' ? '⇄' : category?.icon ?? '•'} title={title} subtitle={subtitle}
      amount={formatMoney(amount, currency)} amountClass={color} onDelete={handleDelete} deleteLabel={`Borrar ${title}`} />
  );
}
