import { useState } from 'react';
import { deleteCard, saveCard, type CardDraft } from '../db/cardsRepo';
import { ValidationError } from '../db/repo';
import { db } from '../db/schema';
import { useAccounts } from '../hooks/useData';
import MoneyInput from './MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton } from './ui';

export const EMPTY_CARD: CardDraft = { name: '', defaultClosingDay: 25, defaultDueDay: 5, archived: false };

const COLORS = ['#3b82f6', '#ef4444', '#f97316', '#10b981', '#a855f7', '#eab308', '#14b8a6', '#64748b'];

export default function CardForm({ draft, onDone, onDeleted }: { draft: CardDraft; onDone: () => void; onDeleted?: () => void }) {
  const accounts = (useAccounts() ?? []).filter((a) => !a.archived && a.currency === 'ARS');
  const [form, setForm] = useState<CardDraft>(draft);
  const [limit, setLimit] = useState<number | null>(draft.limit ?? null);
  const [closing, setClosing] = useState(String(draft.defaultClosingDay));
  const [due, setDue] = useState(String(draft.defaultDueDay));
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveCard(db, { ...form, limit: limit ?? undefined, defaultClosingDay: Number(closing), defaultDueDay: Number(due) });
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  async function handleDelete() {
    if (!form.id || !window.confirm(`¿Borrar la tarjeta "${form.name}"?`)) return;
    try {
      await deleteCard(db, form.id);
      (onDeleted ?? onDone)();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo borrar.']);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className="py-2 text-slate-400">Cancelar</button>
        <h1 className="text-lg font-semibold">{form.id ? 'Editar tarjeta' : 'Nueva tarjeta'}</h1>
        <span className="w-16" />
      </div>

      <Field label="Nombre">
        <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Visa Galicia" autoFocus={!form.id} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Día de cierre">
          <input className={inputClass} inputMode="numeric" value={closing} onChange={(e) => setClosing(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
        <Field label="Día de vencimiento">
          <input className={inputClass} inputMode="numeric" value={due} onChange={(e) => setDue(e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Field>
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        Son los días habituales. Después podés ajustar las fechas de cada resumen, porque los bancos las mueven mes a mes.
      </p>

      <Field label="Límite (opcional)">
        <MoneyInput value={limit} onChange={setLimit} currency="ARS" />
      </Field>

      <Field label="Cuenta con la que pagás el resumen (opcional)">
        <select className={inputClass} value={form.defaultPaymentAccountId ?? ''} onChange={(e) => setForm({ ...form, defaultPaymentAccountId: e.target.value || undefined })}>
          <option value="">Ninguna</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Color" group>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={form.color === c} onClick={() => setForm({ ...form, color: c })}
              className={`h-9 w-9 rounded-full ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </Field>

      {form.id && (
        <label className="flex items-center gap-3 text-sm text-slate-300">
          <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />
          Archivada (no aparece al cargar compras)
        </label>
      )}

      <ErrorList errors={errors} />

      <div className="space-y-2">
        <PrimaryButton type="submit">Guardar</PrimaryButton>
        {form.id && <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">Borrar tarjeta</SecondaryButton>}
      </div>
    </form>
  );
}
