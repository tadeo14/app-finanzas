import { useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import MoneyInput from '../components/MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton } from '../components/ui';
import { totalsByCurrency } from '../domain/accounts';
import { formatMoney } from '../domain/money';
import type { Account } from '../domain/types';
import { deleteAccount, saveAccount, ValidationError, type AccountDraft } from '../db/repo';
import { db } from '../db/schema';
import { useAccounts, useBalances, useTransactions } from '../hooks/useData';

const TYPE_LABEL: Record<Account['type'], string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  wallet: 'Billetera virtual',
  investment: 'Inversión',
};

const EMPTY: AccountDraft = { name: '', type: 'bank', currency: 'ARS', initialBalance: 0, archived: false };

export default function Cuentas() {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const balances = useBalances(accounts, transactions);
  const [editing, setEditing] = useState<AccountDraft | null>(null);

  if (editing) return <AccountForm draft={editing} onDone={() => setEditing(null)} />;

  const active = (accounts ?? []).filter((a) => !a.archived);
  const archived = (accounts ?? []).filter((a) => a.archived);
  const totals = totalsByCurrency(accounts ?? [], balances);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Cuentas</h1>
      </div>

      {accounts && accounts.length === 0 ? (
        <EmptyState>Creá tus cuentas: el banco, el efectivo, Mercado Pago… Cada una con su saldo actual.</EmptyState>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <Total label="Total en pesos" value={formatMoney(totals.ARS, 'ARS')} />
            <Total label="Total en dólares" value={formatMoney(totals.USD, 'USD')} />
          </div>
          <AccountList accounts={active} balances={balances} onEdit={setEditing} />
          {archived.length > 0 && (
            <>
              <h2 className="mb-1 mt-6 text-xs font-medium uppercase tracking-wide text-slate-500">Archivadas</h2>
              <AccountList accounts={archived} balances={balances} onEdit={setEditing} />
            </>
          )}
        </>
      )}

      <PrimaryButton type="button" className="mt-6" onClick={() => setEditing(EMPTY)}>
        Nueva cuenta
      </PrimaryButton>
    </>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function AccountList({ accounts, balances, onEdit }: { accounts: Account[]; balances: Map<string, number>; onEdit: (a: Account) => void }) {
  return (
    <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
      {accounts.map((a) => {
        const balance = balances.get(a.id) ?? a.initialBalance;
        return (
          <li key={a.id}>
            <button type="button" onClick={() => onEdit(a)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-800">
              <span aria-hidden className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: a.color ?? '#475569' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                <span className="block text-xs text-slate-500">{TYPE_LABEL[a.type]} · {a.currency}</span>
              </span>
              <span className={`font-semibold tabular-nums ${balance < 0 ? 'text-red-400' : ''}`}>{formatMoney(balance, a.currency)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f97316', '#ef4444', '#eab308', '#14b8a6', '#64748b'];

function AccountForm({ draft, onDone }: { draft: AccountDraft; onDone: () => void }) {
  const [form, setForm] = useState<AccountDraft>(draft);
  const [initialBalance, setInitialBalance] = useState<number | null>(draft.initialBalance);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveAccount(db, { ...form, initialBalance: initialBalance ?? 0 });
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  async function handleDelete() {
    if (!form.id || !window.confirm(`¿Borrar la cuenta "${form.name}"?`)) return;
    try {
      await deleteAccount(db, form.id);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo borrar.']);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className="py-2 text-slate-400">Cancelar</button>
        <h1 className="text-lg font-semibold">{form.id ? 'Editar cuenta' : 'Nueva cuenta'}</h1>
        <span className="w-16" />
      </div>

      <Field label="Nombre">
        <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Galicia, Efectivo, Mercado Pago" autoFocus={!form.id} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className={inputClass} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Moneda">
          <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Account['currency'] })}>
            <option value="ARS">Pesos (ARS)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </Field>
      </div>

      <Field label="Saldo inicial">
        <MoneyInput value={initialBalance} onChange={setInitialBalance} currency={form.currency} />
      </Field>

      <Field label="Color" group>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={form.color === c}
              onClick={() => setForm({ ...form, color: c })}
              className={`h-9 w-9 rounded-full ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950' : ''}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      {form.id && (
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />
          Archivada (no aparece al cargar movimientos ni suma en los totales)
        </label>
      )}

      <ErrorList errors={errors} />

      <div className="space-y-2">
        <PrimaryButton type="submit">Guardar</PrimaryButton>
        {form.id && (
          <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">Borrar cuenta</SecondaryButton>
        )}
      </div>
    </form>
  );
}
