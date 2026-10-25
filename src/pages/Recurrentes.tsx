import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CategoryGrid from '../components/CategoryGrid';
import EmptyState from '../components/EmptyState';
import MoneyInput from '../components/MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { formatDate, parseDate, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { nextOccurrence, occurrencesDue } from '../domain/recurring';
import type { CardPurchase, Currency, Recurring, Transaction } from '../domain/types';
import { ValidationError } from '../db/errors';
import { deleteRecurring, saveRecurring, type RecurringDraft } from '../db/recurringRepo';
import { db } from '../db/schema';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useAccounts, useCards, useCategories } from '../hooks/useData';

const FREQUENCY: Record<Recurring['frequency'], string> = { monthly: 'Todos los meses', weekly: 'Todas las semanas', yearly: 'Todos los años' };

export default function Recurrentes() {
  const recurrings = useLiveQuery(() => db.recurrings.toArray(), []);
  const accounts = useAccounts() ?? [];
  const cards = useCards() ?? [];
  const [editing, setEditing] = useState<RecurringDraft | null>(null);

  if (editing) return <RecurringForm draft={editing} onDone={() => setEditing(null)} />;
  if (!recurrings) return null;

  const now = today();
  const sorted = [...recurrings].sort((a, b) => ((a.template as { description?: string }).description ?? '').localeCompare((b.template as { description?: string }).description ?? '', 'es'));

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Recurrentes</h1>
      </div>
      <p className="mb-4 text-sm text-slate-400">Gastos e ingresos fijos y suscripciones. Al abrir la app se cargan solos los que corresponden hasta hoy.</p>

      {sorted.length === 0 ? (
        <EmptyState>Todavía no tenés recurrentes. Agregá el alquiler, el sueldo o una suscripción y se cargan solos cada mes.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
          {sorted.map((r) => {
            const t = r.template as Partial<Transaction & CardPurchase>;
            const amount = r.kind === 'transaction' ? t.amount : t.totalAmount;
            const where = r.kind === 'transaction' ? accounts.find((a) => a.id === t.accountId)?.name : cards.find((c) => c.id === t.cardId)?.name;
            const next = nextOccurrence(r, now);
            const income = r.kind === 'transaction' && t.type === 'income';
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setEditing(r)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-800">
                  <span aria-hidden className="text-xl">{r.kind === 'cardPurchase' ? '💳' : income ? '⬇️' : '⬆️'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.description || 'Sin descripción'}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {FREQUENCY[r.frequency]} · {where ?? 'Sin cuenta'} · {next ? `próxima ${formatDate(next)}` : 'terminó'}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${income ? 'text-emerald-400' : ''}`}>{formatMoney(amount ?? 0, t.currency ?? 'ARS')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PrimaryButton type="button" className="mt-6" onClick={() => setEditing({ kind: 'transaction', template: { type: 'expense' }, frequency: 'monthly', startDate: today() })}>
        Nuevo recurrente
      </PrimaryButton>
    </>
  );
}

type Kind = Recurring['kind'];

function RecurringForm({ draft, onDone }: { draft: RecurringDraft; onDone: () => void }) {
  const accounts = (useAccounts() ?? []).filter((a) => !a.archived || a.id === (draft.template as Partial<Transaction>).accountId);
  const cards = (useCards() ?? []).filter((c) => !c.archived || c.id === (draft.template as Partial<CardPurchase>).cardId);
  const categories = useCategories();

  const t = draft.template as Partial<Transaction & CardPurchase>;
  const [kind, setKind] = useState<Kind>(draft.kind);
  const [type, setType] = useState<'expense' | 'income'>(t.type === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState<number | null>((draft.kind === 'transaction' ? t.amount : t.totalAmount) ?? null);
  const [description, setDescription] = useState(t.description ?? '');
  const [accountId, setAccountId] = useState(t.accountId ?? accounts[0]?.id ?? '');
  const [cardId, setCardId] = useState(t.cardId ?? cards[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState<string | undefined>(t.categoryId);
  const [currency, setCurrency] = useState<Currency>(t.currency ?? 'ARS');
  const [frequency, setFrequency] = useState(draft.frequency);
  const [dayOfMonth, setDayOfMonth] = useState(draft.dayOfMonth ? String(draft.dayOfMonth) : '');
  const [startDate, setStartDate] = useState(draft.startDate);
  const [endDate, setEndDate] = useState(draft.endDate ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  // Cuenta y tarjeta por defecto: las listas cargan después del primer render, así que se completan cuando llegan.
  const firstAccount = accounts[0]?.id;
  const firstCard = cards[0]?.id;
  useEffect(() => {
    if (!accountId && firstAccount) setAccountId(firstAccount);
  }, [accountId, firstAccount]);
  useEffect(() => {
    if (!cardId && firstCard) setCardId(firstCard);
  }, [cardId, firstCard]);

  const kindOfCategory = kind === 'transaction' && type === 'income' ? 'income' : 'expense';
  const visibleCategories = categories.filter((c) => c.kind === kindOfCategory && c.id !== CARD_PAYMENT_CATEGORY_ID);

  const built: RecurringDraft = {
    ...draft,
    kind,
    template:
      kind === 'transaction'
        ? { type, accountId, amount: amount ?? 0, categoryId, description: description.trim() }
        : { cardId, totalAmount: amount ?? 0, categoryId, description: description.trim(), currency },
    frequency,
    dayOfMonth: frequency === 'monthly' && dayOfMonth ? Number(dayOfMonth) : undefined,
    startDate,
    endDate: endDate || undefined,
  };

  // Aviso de lo que se va a generar de golpe cuando el inicio es pasado.
  let backfill = 0;
  let validDate = true;
  try {
    parseDate(startDate);
    backfill = occurrencesDue({ ...built, lastGenerated: draft.lastGenerated }, today()).length;
  } catch {
    validDate = false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveRecurring(db, built);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  async function handleDelete() {
    if (!draft.id || !window.confirm('¿Borrar este recurrente? Lo que ya generó se conserva.')) return;
    await deleteRecurring(db, draft.id);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className="py-2 text-slate-400">Cancelar</button>
        <h1 className="text-lg font-semibold">{draft.id ? 'Editar recurrente' : 'Nuevo recurrente'}</h1>
        <span className="w-16" />
      </div>

      <Segmented<Kind> value={kind} onChange={(k) => { setKind(k); setCategoryId(undefined); }} options={[{ value: 'transaction', label: 'Con una cuenta' }, { value: 'cardPurchase', label: 'Con tarjeta' }]} />
      {kind === 'transaction' && (
        <Segmented<'expense' | 'income'> value={type} onChange={(v) => { setType(v); setCategoryId(undefined); }} options={[{ value: 'expense', label: 'Gasto' }, { value: 'income', label: 'Ingreso' }]} />
      )}

      <Field label="Monto"><MoneyInput value={amount} onChange={setAmount} currency={kind === 'cardPurchase' ? currency : accounts.find((a) => a.id === accountId)?.currency ?? 'ARS'} large autoFocus={!draft.id} /></Field>

      <Field label="Descripción">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: Netflix, Alquiler, Sueldo" />
      </Field>

      {kind === 'transaction' ? (
        <Field label="Cuenta">
          <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.length === 0 && <option value="">Primero creá una cuenta</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tarjeta">
            <select className={inputClass} value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {cards.length === 0 && <option value="">Primero creá una tarjeta</option>}
              {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Moneda">
            <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="ARS">Pesos</option>
              <option value="USD">Dólares</option>
            </select>
          </Field>
        </div>
      )}

      <Field label="Categoría" group>
        <CategoryGrid categories={visibleCategories} value={categoryId} onChange={setCategoryId} />
      </Field>

      <Field label="Frecuencia">
        <select className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as Recurring['frequency'])}>
          {Object.entries(FREQUENCY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>

      {frequency === 'monthly' && (
        <Field label="Día del mes (opcional)">
          <input className={inputClass} inputMode="numeric" value={dayOfMonth} placeholder="Por defecto, el día de inicio" onChange={(e) => setDayOfMonth(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
      )}
      {frequency === 'monthly' && <p className="-mt-3 text-xs text-slate-500">Si el mes no tiene ese día (por ejemplo el 31 en febrero), se usa el último día del mes.</p>}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde"><input type="date" className={inputClass} value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></Field>
        <Field label="Hasta (opcional)"><input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>

      {validDate && backfill > 0 && (
        <p className="rounded-xl bg-amber-950/50 p-3 text-sm text-amber-200">
          Al guardar se {backfill === 1 ? 'va a generar 1 movimiento' : `van a generar ${backfill} movimientos`} desde el {formatDate(startDate)} hasta hoy.
          {backfill > 60 && ' Son muchos: revisá la fecha de inicio.'}
        </p>
      )}

      <ErrorList errors={errors} />
      <div className="space-y-2">
        <PrimaryButton type="submit">Guardar</PrimaryButton>
        {draft.id && <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">Borrar recurrente</SecondaryButton>}
      </div>
    </form>
  );
}
