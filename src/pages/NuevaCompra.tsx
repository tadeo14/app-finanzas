import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CategoryGrid from '../components/CategoryGrid';
import MoneyInput from '../components/MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { previewPurchase, validatePurchase } from '../domain/cards';
import { periodsWithPayments } from '../domain/payments';
import { formatPeriod, today } from '../domain/dates';
import type { CardPurchase, Currency } from '../domain/types';
import { deletePurchase, savePurchase } from '../db/cardsRepo';
import { ValidationError } from '../db/repo';
import { db } from '../db/schema';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useCards, useCategories, useInstallments, usePayments, usePurchase, useStatements } from '../hooks/useData';

const PRESETS = [1, 3, 6, 9, 12, 18, 24];
type Mode = 'expense' | 'income' | 'transfer' | 'card';

/** Carga rápida de una compra con tarjeta (/nuevo/tarjeta) y edición de una existente (/compras/:id). */
export default function NuevaCompra() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = usePurchase(id);
  const cards = useCards();
  const categories = useCategories();

  const [cardId, setCardId] = useState<string>();
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>();
  const [date, setDate] = useState(today());
  const [installments, setInstallments] = useState(1);
  const [perInstallment, setPerInstallment] = useState(false);
  const [currency, setCurrency] = useState<Currency>('ARS');
  const [alreadyPaid, setAlreadyPaid] = useState('0');
  const [firstPeriod, setFirstPeriod] = useState('');
  const [isRefund, setIsRefund] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Al editar, volcar la compra en el formulario una sola vez.
  const [loadedId, setLoadedId] = useState<string>();
  useEffect(() => {
    if (!existing || loadedId === existing.id) return;
    setLoadedId(existing.id);
    setCardId(existing.cardId);
    setAmount(existing.amountMode === 'perInstallment' ? existing.installmentAmount ?? null : existing.totalAmount);
    setPerInstallment(existing.amountMode === 'perInstallment');
    setDescription(existing.description);
    setCategoryId(existing.categoryId);
    setDate(existing.date);
    setInstallments(existing.installments);
    setCurrency(existing.currency);
    setAlreadyPaid(String(existing.startInstallment - 1));
    setFirstPeriod(existing.firstPeriodOverride ?? '');
    setIsRefund(existing.isRefund);
  }, [existing, loadedId]);

  const usableCards = useMemo(
    () => (cards ?? []).filter((c) => !c.archived || c.id === existing?.cardId),
    [cards, existing],
  );

  // Tarjeta por defecto al cargar una nueva: la de la última compra, o la primera.
  const [lastCardId, setLastCardId] = useState<string | null>();
  useEffect(() => {
    let cancelled = false;
    void db.cardPurchases.toArray().then((all) => {
      if (!cancelled) setLastCardId(all.sort((a, b) => b.date.localeCompare(a.date)).at(0)?.cardId ?? null);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (id || cardId || lastCardId === undefined || !usableCards.length) return;
    setCardId((usableCards.find((c) => c.id === lastCardId) ?? usableCards[0]!).id);
  }, [id, cardId, lastCardId, usableCards]);

  const card = usableCards.find((c) => c.id === cardId);
  const statements = useStatements(cardId) ?? [];
  const ownInstallments = useInstallments(cardId) ?? [];
  const payments = usePayments() ?? [];
  const hadAdvance = ownInstallments.some((i) => i.purchaseId === id && i.status === 'cancelled');
  // Aviso (SPEC §4.4): editar regenera las cuotas, y alguna puede caer en un resumen que ya tiene pagos.
  const paidPeriods = card ? periodsWithPayments(card, statements, payments) : new Set<string>();
  const paidAffected = id
    ? [...new Set(ownInstallments.filter((i) => i.purchaseId === id && i.status === 'scheduled' && paidPeriods.has(i.period)).map((i) => i.period))].sort()
    : [];
  const expenseCategories = categories.filter((c) => c.kind === 'expense' && c.id !== CARD_PAYMENT_CATEGORY_ID);

  const draft: Omit<CardPurchase, 'id'> | null =
    card && amount !== null
      ? {
          cardId: card.id,
          date,
          description,
          categoryId: categoryId ?? '',
          currency,
          installments,
          amountMode: perInstallment ? 'perInstallment' : 'total',
          totalAmount: perInstallment ? 0 : amount,
          installmentAmount: perInstallment ? amount : undefined,
          startInstallment: Number(alreadyPaid || 0) + 1,
          firstPeriodOverride: firstPeriod || undefined,
          isRefund,
        }
      : null;

  // El preview solo se muestra cuando lo cargado alcanza para calcularlo (la categoría puede faltar todavía).
  const preview = useMemo(() => {
    if (!draft || !card) return null;
    if (validatePurchase({ ...draft, categoryId: draft.categoryId || 'pendiente' }).length) return null;
    try {
      return previewPurchase({ ...draft, id: 'preview' }, card, statements);
    } catch {
      return null;
    }
  }, [draft, card, statements]);

  if (id && existing === null) {
    return <p className="py-10 text-center text-slate-400">Esa compra no existe. <Link to="/movimientos" className="text-emerald-400">Volver</Link></p>;
  }
  if (id && loadedId !== id) return null;
  if (cards && usableCards.length === 0) {
    return (
      <div className="space-y-4 py-10 text-center text-slate-400">
        <p>Para cargar compras con tarjeta primero agregá una tarjeta.</p>
        <Link to="/tarjetas" className="inline-block rounded-xl bg-brand px-4 py-3 font-semibold text-white">Ir a Tarjetas</Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) {
      setErrors(['Ingresá un monto.']);
      return;
    }
    setSaving(true);
    try {
      await savePurchase(db, { ...draft, id });
      navigate(-1);
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !window.confirm('¿Borrar esta compra y todas sus cuotas?')) return;
    await deletePurchase(db, id);
    navigate(-1);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => navigate(-1)} className="py-2 text-slate-400">Cancelar</button>
        <h1 className="text-lg font-semibold">{id ? 'Editar compra' : 'Nueva compra'}</h1>
        <span className="w-16" />
      </div>

      {!id && (
        <Segmented<Mode>
          value="card"
          onChange={(m) => m !== 'card' && navigate('/nuevo', { replace: true, state: { mode: m } })}
          options={[
            { value: 'expense', label: 'Gasto' },
            { value: 'income', label: 'Ingreso' },
            { value: 'transfer', label: 'Transferencia' },
            { value: 'card', label: 'Tarjeta' },
          ]}
        />
      )}

      <Field label={perInstallment ? 'Monto de cada cuota' : 'Monto total'}>
        <MoneyInput value={amount} onChange={setAmount} currency={currency} large autoFocus={!id} />
      </Field>

      <Field label="Descripción">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: TV Samsung" enterKeyHint="done" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tarjeta">
          <select className={inputClass} value={cardId ?? ''} onChange={(e) => setCardId(e.target.value)}>
            {usableCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Fecha">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
      </div>

      <Field label="Cuotas" group>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((n) => (
            <button key={n} type="button" aria-pressed={installments === n} onClick={() => setInstallments(n)}
              className={`min-w-12 rounded-xl border px-3 py-2.5 text-sm font-medium ${installments === n ? 'border-emerald-500 bg-emerald-950/60 text-slate-100' : 'border-slate-800 bg-slate-900 text-slate-300'}`}>
              {n}
            </button>
          ))}
          <input aria-label="Otra cantidad de cuotas" inputMode="numeric" placeholder="Otra" value={PRESETS.includes(installments) ? '' : installments || ''}
            onChange={(e) => setInstallments(Number(e.target.value.replace(/\D/g, '')) || 0)}
            className="w-20 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-center text-sm focus:border-emerald-500 focus:outline-none" />
        </div>
      </Field>

      <label className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-3 text-sm">
        <span>Cargar el monto de cada cuota (cuotas con interés)</span>
        <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={perInstallment} onChange={(e) => setPerInstallment(e.target.checked)} />
      </label>

      <p aria-live="polite" className={`min-h-6 rounded-xl px-3 py-2 text-sm ${preview ? 'bg-emerald-950/50 text-emerald-200' : 'text-slate-500'}`}>
        {preview ? preview.text : 'Ingresá el monto para ver en qué resúmenes caen las cuotas.'}
      </p>

      <Field label="Categoría" group>
        <CategoryGrid categories={expenseCategories} value={categoryId} onChange={setCategoryId} />
      </Field>

      <details className="rounded-xl bg-slate-900 p-3">
        <summary className="cursor-pointer text-sm text-slate-300">Opciones avanzadas</summary>
        <div className="mt-4 space-y-4">
          <Field label="Moneda">
            <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option value="ARS">Pesos (ARS)</option>
              <option value="USD">Dólares (USD) — suma al saldo en dólares del resumen</option>
            </select>
          </Field>
          <Field label="Cuotas que ya pagaste">
            <input className={inputClass} inputMode="numeric" value={alreadyPaid} onChange={(e) => setAlreadyPaid(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <p className="-mt-2 text-xs text-slate-500">Para cargar una compra que ya venías pagando: se generan solo las cuotas que faltan, empezando en el resumen que corresponde a la fecha.</p>
          <Field label="Forzar el primer resumen">
            <div className="flex gap-2">
              <input type="month" className={inputClass} value={firstPeriod} onChange={(e) => setFirstPeriod(e.target.value)} />
              {firstPeriod && <button type="button" onClick={() => setFirstPeriod('')} className="shrink-0 px-3 text-sm text-slate-400">Quitar</button>}
            </div>
          </Field>
          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
            Es una devolución o bonificación (resta del resumen)
          </label>
        </div>
      </details>

      {paidAffected.length > 0 && (
        <p className="rounded-xl bg-amber-950/50 p-3 text-xs text-amber-200">
          Alguna cuota de esta compra cae en un resumen que ya tiene pagos ({paidAffected.map(formatPeriod).join(', ')}). Si cambiás montos, fechas o cuotas, los pagos registrados no se modifican: revisalos después.
        </p>
      )}

      {hadAdvance && (
        <p className="rounded-xl bg-amber-950/50 p-3 text-xs text-amber-200">
          Esta compra tiene cuotas adelantadas. Si guardás cambios, las cuotas se vuelven a generar y el adelanto se deshace.
        </p>
      )}

      <ErrorList errors={errors} />

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] space-y-2 bg-slate-950 pb-2 pt-2">
        <PrimaryButton type="submit" disabled={saving}>{id ? 'Guardar cambios' : 'Guardar'}</PrimaryButton>
        {id && <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">Borrar compra</SecondaryButton>}
      </div>
    </form>
  );
}
