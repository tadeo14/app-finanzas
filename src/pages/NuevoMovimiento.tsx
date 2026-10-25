import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CategoryGrid from '../components/CategoryGrid';
import MoneyInput from '../components/MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton, Segmented, SecondaryButton } from '../components/ui';
import { today } from '../domain/dates';
import type { Transaction } from '../domain/types';
import { deleteTransaction, saveTransaction, ValidationError } from '../db/repo';
import { db } from '../db/schema';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useAccounts, useCategories, useTransaction } from '../hooks/useData';

type Mode = Transaction['type'] | 'card';

const MODES: { value: Mode; label: string; disabled?: boolean }[] = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'card', label: 'Tarjeta', disabled: true }, // llega en la fase 3
];

/** Carga rápida (/nuevo) y edición (/movimientos/:id) de gastos, ingresos y transferencias. */
export default function NuevoMovimiento() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useTransaction(id);
  const allAccounts = useAccounts();
  const categories = useCategories();

  const [mode, setMode] = useState<Mode>('expense');
  const [amount, setAmount] = useState<number | null>(null);
  const [toAmount, setToAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>();
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string>();
  const [toAccountId, setToAccountId] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Al editar, volcar el movimiento en el formulario una sola vez.
  const [loadedId, setLoadedId] = useState<string>();
  useEffect(() => {
    if (!existing || loadedId === existing.id) return;
    setLoadedId(existing.id);
    setMode(existing.type);
    setAmount(existing.amount);
    setToAmount(existing.toAmount ?? null);
    setDescription(existing.description);
    setCategoryId(existing.categoryId);
    setDate(existing.date);
    setAccountId(existing.accountId);
    setToAccountId(existing.toAccountId);
  }, [existing, loadedId]);

  // Las cuentas archivadas no se ofrecen, salvo la que ya usa el movimiento que se edita.
  const accounts = useMemo(
    () => (allAccounts ?? []).filter((a) => !a.archived || a.id === existing?.accountId || a.id === existing?.toAccountId),
    [allAccounts, existing],
  );

  // Cuenta por defecto al cargar uno nuevo: la del último movimiento; si no hay, la primera en pesos.
  const lastAccountId = useLiveQuery(async () => (await db.transactions.orderBy('date').last())?.accountId ?? null, []);
  useEffect(() => {
    if (id || accountId || lastAccountId === undefined || !accounts.length) return;
    const last = accounts.find((a) => a.id === lastAccountId && !a.archived);
    setAccountId((last ?? accounts.find((a) => a.currency === 'ARS') ?? accounts[0]!).id);
  }, [id, accountId, lastAccountId, accounts]);

  const type: Transaction['type'] = mode === 'card' ? 'expense' : mode;
  const from = accounts.find((a) => a.id === accountId);
  const to = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = type === 'transfer' && from && to && from.currency !== to.currency;
  const isCardPayment = Boolean(existing?.statementPaymentId);
  const visibleCategories = categories.filter(
    (c) => c.kind === (type === 'income' ? 'income' : 'expense') && c.id !== CARD_PAYMENT_CATEGORY_ID,
  );

  if (id && existing === null) {
    return (
      <p className="py-10 text-center text-slate-400">
        Ese movimiento no existe. <Link to="/movimientos" className="text-emerald-400">Volver</Link>
      </p>
    );
  }

  // En edición, no mostrar el formulario hasta volcar el movimiento: si no, lo que tipee el usuario se pisa.
  if (id && loadedId !== id) return null;

  if (allAccounts && !accounts.length) {
    return (
      <div className="space-y-4 py-10 text-center text-slate-400">
        <p>Para cargar movimientos primero creá una cuenta (banco, efectivo o billetera).</p>
        <Link to="/mas/cuentas" className="inline-block rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white">
          Crear cuenta
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (amount === null) {
      setErrors(['Ingresá un monto.']);
      return;
    }
    setSaving(true);
    try {
      await saveTransaction(db, {
        ...(existing ?? {}),
        id,
        type,
        amount,
        toAmount: crossCurrency ? toAmount ?? undefined : undefined,
        description,
        categoryId: type === 'transfer' ? undefined : categoryId,
        date,
        accountId: accountId ?? '',
        toAccountId: type === 'transfer' ? toAccountId : undefined,
      });
      navigate(-1);
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !window.confirm('¿Borrar este movimiento?')) return;
    await deleteTransaction(db, id);
    navigate(-1);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => navigate(-1)} className="py-2 text-slate-400">
          Cancelar
        </button>
        <h1 className="text-lg font-semibold">{id ? 'Editar movimiento' : 'Nuevo movimiento'}</h1>
        <span className="w-16" />
      </div>

      {!isCardPayment && (
        <Segmented
          options={id ? MODES.filter((m) => m.value !== 'card') : MODES}
          value={mode}
          onChange={(m) => {
            setMode(m);
            setCategoryId(undefined);
          }}
        />
      )}

      <MoneyInput value={amount} onChange={setAmount} currency={from?.currency ?? 'ARS'} large autoFocus={!id} />

      <Field label="Descripción">
        <input
          className={inputClass}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={type === 'transfer' ? 'Ej.: retiro del cajero' : 'Ej.: supermercado'}
          enterKeyHint="done"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={type === 'transfer' ? 'Desde' : 'Cuenta'}>
          <select className={inputClass} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </Field>
        {type === 'transfer' ? (
          <Field label="Hacia">
            <select className={inputClass} value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || undefined)}>
              <option value="">Elegí…</option>
              {accounts
                .filter((a) => a.id !== accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field label="Fecha">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        )}
      </div>

      {type === 'transfer' && (
        <Field label="Fecha">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      )}

      {crossCurrency && to && (
        <Field label={`Llega a ${to.name}`}>
          <MoneyInput value={toAmount} onChange={setToAmount} currency={to.currency} />
        </Field>
      )}

      {type !== 'transfer' && !isCardPayment && (
        <Field label="Categoría" group>
          <CategoryGrid categories={visibleCategories} value={categoryId} onChange={setCategoryId} />
        </Field>
      )}

      <ErrorList errors={errors} />

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] space-y-2 bg-slate-950 pb-2 pt-2">
        <PrimaryButton type="submit" disabled={saving}>
          {id ? 'Guardar cambios' : 'Guardar'}
        </PrimaryButton>
        {id && (
          <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">
            Borrar
          </SecondaryButton>
        )}
      </div>
    </form>
  );
}
