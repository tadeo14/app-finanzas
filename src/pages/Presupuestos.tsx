import { useState } from 'react';
import { Link } from 'react-router-dom';
import MoneyInput from '../components/MoneyInput';
import MonthSelector from '../components/MonthSelector';
import { ErrorList, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import { periodOf, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { effectiveBudget } from '../domain/reports';
import type { Category } from '../domain/types';
import { deleteBudget, saveBudget } from '../db/catalogRepo';
import { ValidationError } from '../db/errors';
import { db } from '../db/schema';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useBudgets, useCategories } from '../hooks/useData';

type Scope = 'default' | 'month';

export default function Presupuestos() {
  const categories = useCategories().filter((c) => c.kind === 'expense' && c.id !== CARD_PAYMENT_CATEGORY_ID);
  const budgets = useBudgets() ?? [];
  const [scope, setScope] = useState<Scope>('default');
  const [month, setMonth] = useState(() => periodOf(today()));
  const [editing, setEditing] = useState<string>();
  const key = scope === 'default' ? 'default' : month;

  const roots = categories.filter((c) => !c.parentId);
  const ordered = roots.flatMap((r) => [r, ...categories.filter((c) => c.parentId === r.id)]);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Presupuestos</h1>
      </div>

      <Segmented<Scope>
        value={scope}
        onChange={(s) => { setScope(s); setEditing(undefined); }}
        options={[{ value: 'default', label: 'Todos los meses' }, { value: 'month', label: 'Un mes puntual' }]}
      />
      <div className="mt-3">
        {scope === 'month' ? (
          <MonthSelector value={month} onChange={(m) => { setMonth(m); setEditing(undefined); }} />
        ) : null}
      </div>
      <p className="mb-3 mt-3 text-xs text-slate-500">
        {scope === 'default'
          ? 'El presupuesto de todos los meses se repite cada mes, salvo que definas uno puntual para ese mes.'
          : 'El presupuesto de un mes puntual reemplaza al de todos los meses sólo en ese mes. El gasto de una categoría incluye sus subcategorías.'}
      </p>

      {ordered.length === 0 ? (
        <p className="text-sm text-slate-500">No hay categorías de gasto.</p>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
          {ordered.map((c) => {
            const own = budgets.find((b) => b.categoryId === c.id && b.month === key);
            const shown = scope === 'month' ? effectiveBudget(c.id, month, budgets) : own;
            return (
              <li key={c.id}>
                {editing === c.id ? (
                  <BudgetEditor category={c} month={key} current={own?.amount} onDone={() => setEditing(undefined)} />
                ) : (
                  <button type="button" onClick={() => setEditing(c.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-800">
                    <span aria-hidden className={`text-xl ${c.parentId ? 'ml-5' : ''}`}>{c.icon ?? '•'}</span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {shown ? (
                      <span className="text-right text-sm tabular-nums">
                        {formatMoney(shown.amount)}
                        {scope === 'month' && shown.month === 'default' && <span className="block text-[11px] text-slate-500">todos los meses</span>}
                      </span>
                    ) : (
                      <span className="text-sm text-slate-600">Sin presupuesto</span>
                    )}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function BudgetEditor({ category, month, current, onDone }: { category: Category; month: string; current?: number; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(current ?? null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSave() {
    try {
      await saveBudget(db, category.id, month, amount ?? 0);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  async function handleRemove() {
    await deleteBudget(db, category.id, month);
    onDone();
  }

  return (
    <div className="space-y-3 p-3">
      <p className="font-medium"><span aria-hidden>{category.icon} </span>{category.name}</p>
      <MoneyInput value={amount} onChange={setAmount} currency="ARS" autoFocus />
      <ErrorList errors={errors} />
      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton type="button" onClick={onDone}>Cancelar</SecondaryButton>
        <PrimaryButton type="button" onClick={handleSave} className="py-3 text-sm">Guardar</PrimaryButton>
      </div>
      {current !== undefined && <SecondaryButton type="button" onClick={handleRemove} className="border-red-900 text-red-300">Quitar presupuesto</SecondaryButton>}
    </div>
  );
}
