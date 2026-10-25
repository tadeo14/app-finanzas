import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MonthSelector from '../components/MonthSelector';
import PageHeader from '../components/PageHeader';
import { inputClass } from '../components/ui';
import { filterTransactions, groupByDay, signedAmountFor, type TransactionFilters } from '../domain/accounts';
import { formatDate, periodOf, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import type { Account, Category, Transaction } from '../domain/types';
import { deleteTransaction } from '../db/repo';
import { db } from '../db/schema';
import { useAccounts, useCategories, useTransactions } from '../hooks/useData';

const TYPE_LABEL: Record<Transaction['type'], string> = { expense: 'Gastos', income: 'Ingresos', transfer: 'Transferencias' };

export default function Movimientos() {
  const transactions = useTransactions();
  const accounts = useAccounts() ?? [];
  const categories = useCategories();
  const [month, setMonth] = useState(() => periodOf(today()));
  const [filters, setFilters] = useState<Omit<TransactionFilters, 'month'>>({});
  const [showFilters, setShowFilters] = useState(false);

  const visible = useMemo(
    () => filterTransactions(transactions ?? [], { ...filters, month }, categories),
    [transactions, filters, month, categories],
  );
  const groups = groupByDay(visible);
  const activeFilters = [filters.accountId, filters.categoryId, filters.type].filter(Boolean).length;

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <>
      <PageHeader title="Movimientos" />
      <div className="space-y-3">
        <MonthSelector value={month} onChange={setMonth} />
        <div className="flex gap-2">
          <input
            type="search"
            className={inputClass}
            placeholder="Buscar…"
            value={filters.text ?? ''}
            onChange={(e) => setFilters({ ...filters, text: e.target.value || undefined })}
          />
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`shrink-0 rounded-xl border px-3 text-sm ${activeFilters ? 'border-emerald-600 text-emerald-300' : 'border-slate-700 text-slate-300'}`}
          >
            Filtros{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 gap-2 rounded-xl bg-slate-900 p-3">
            <select className={inputClass} value={filters.type ?? ''} onChange={(e) => setFilters({ ...filters, type: (e.target.value || undefined) as Transaction['type'] | undefined })}>
              <option value="">Todos los tipos</option>
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select className={inputClass} value={filters.accountId ?? ''} onChange={(e) => setFilters({ ...filters, accountId: e.target.value || undefined })}>
              <option value="">Todas las cuentas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archivada)' : ''}</option>
              ))}
            </select>
            <select className={inputClass} value={filters.categoryId ?? ''} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })}>
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name} ({c.kind === 'income' ? 'ingreso' : 'gasto'})</option>
              ))}
            </select>
            {activeFilters > 0 && (
              <button type="button" onClick={() => setFilters({ text: filters.text })} className="py-2 text-sm text-slate-400">
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {transactions === undefined ? null : groups.length === 0 ? (
          <EmptyState>
            {transactions.length === 0
              ? 'Todavía no cargaste movimientos. Tocá + para registrar un gasto, ingreso o transferencia.'
              : 'No hay movimientos que coincidan en este mes.'}
          </EmptyState>
        ) : (
          groups.map((group) => (
            <section key={group.date}>
              <h2 className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-slate-500">{formatDate(group.date)}</h2>
              <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
                {group.items.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} accountById={accountById} categoryById={categoryById} filterAccountId={filters.accountId} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

function TransactionRow({
  tx,
  accountById,
  categoryById,
  filterAccountId,
}: {
  tx: Transaction;
  accountById: Map<string, Account>;
  categoryById: Map<string, Category>;
  filterAccountId?: string;
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
    <li className="flex items-center">
      <Link to={`/movimientos/${tx.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 active:bg-slate-800">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-lg">
          {tx.type === 'transfer' ? '⇄' : category?.icon ?? '•'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-slate-500">{subtitle}</span>
        </span>
        <span className={`shrink-0 text-sm font-semibold tabular-nums ${color}`}>{formatMoney(amount, currency)}</span>
      </Link>
      <button type="button" onClick={handleDelete} aria-label={`Borrar ${title}`} className="px-3 py-3 text-slate-600 active:text-red-400">
        🗑
      </button>
    </li>
  );
}
