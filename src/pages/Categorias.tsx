import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import type { Category } from '../domain/types';
import { deleteCategory, saveCategory, type CategoryDraft } from '../db/catalogRepo';
import { ValidationError } from '../db/errors';
import { db } from '../db/schema';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useCategories } from '../hooks/useData';

type Kind = Category['kind'];
const COLORS = ['#22c55e', '#f97316', '#0ea5e9', '#eab308', '#a855f7', '#ef4444', '#6366f1', '#ec4899', '#14b8a6', '#64748b'];

export default function Categorias() {
  const categories = useCategories();
  const [kind, setKind] = useState<Kind>('expense');
  const [editing, setEditing] = useState<CategoryDraft | null>(null);

  if (editing) return <CategoryForm draft={editing} categories={categories} onDone={() => setEditing(null)} />;

  const ofKind = categories.filter((c) => c.kind === kind);
  const roots = ofKind.filter((c) => !c.parentId || !ofKind.some((p) => p.id === c.parentId));
  const rows = roots.flatMap((r) => [r, ...ofKind.filter((c) => c.parentId === r.id)]);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Categorías</h1>
      </div>
      <Segmented<Kind> value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }]} />

      <ul className="mt-4 divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
        {rows.map((c) => {
          const locked = c.id === CARD_PAYMENT_CATEGORY_ID;
          const content = (
            <>
              <span aria-hidden className={`flex h-8 w-8 items-center justify-center rounded-full text-lg ${c.parentId ? 'ml-5' : ''}`} style={{ background: `${c.color ?? '#475569'}33` }}>{c.icon ?? '•'}</span>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {locked && <span className="text-xs text-slate-500">🔒 del sistema</span>}
            </>
          );
          return (
            <li key={c.id}>
              {locked ? (
                <div className="flex items-center gap-3 px-3 py-3 opacity-70">{content}</div>
              ) : (
                <button type="button" onClick={() => setEditing(c)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-800">{content}</button>
              )}
            </li>
          );
        })}
      </ul>

      <PrimaryButton type="button" className="mt-6" onClick={() => setEditing({ name: '', kind })}>
        Nueva categoría de {kind === 'expense' ? 'gastos' : 'ingresos'}
      </PrimaryButton>
    </>
  );
}

function CategoryForm({ draft, categories, onDone }: { draft: CategoryDraft; categories: Category[]; onDone: () => void }) {
  const [form, setForm] = useState<CategoryDraft>(draft);
  const [errors, setErrors] = useState<string[]>([]);
  // Padres posibles: categorías raíz del mismo tipo (la interfaz maneja dos niveles).
  const parents = categories.filter((c) => c.kind === form.kind && !c.parentId && c.id !== form.id && c.id !== CARD_PAYMENT_CATEGORY_ID);
  const hasChildren = form.id !== undefined && categories.some((c) => c.parentId === form.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveCategory(db, form);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  async function handleDelete() {
    if (!form.id || !window.confirm(`¿Borrar la categoría "${form.name}"?`)) return;
    try {
      await deleteCategory(db, form.id);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo borrar.']);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onDone} className="py-2 text-slate-400">Cancelar</button>
        <h1 className="text-lg font-semibold">{form.id ? 'Editar categoría' : 'Nueva categoría'}</h1>
        <span className="w-16" />
      </div>

      <Field label="Nombre">
        <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej.: Mascotas" autoFocus={!form.id} />
      </Field>

      <Field label="Ícono (un emoji)">
        <input className={inputClass} value={form.icon ?? ''} onChange={(e) => setForm({ ...form, icon: e.target.value.trim().slice(0, 4) || undefined })} placeholder="🐶" />
      </Field>

      <Field label="Es subcategoría de">
        <select className={inputClass} value={form.parentId ?? ''} disabled={hasChildren} onChange={(e) => setForm({ ...form, parentId: e.target.value || undefined })}>
          <option value="">Ninguna (categoría principal)</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </Field>
      {hasChildren && <p className="-mt-3 text-xs text-slate-500">Tiene subcategorías, así que no puede colgar de otra.</p>}

      <Field label="Tipo">
        <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind, parentId: undefined })}>
          <option value="expense">Gasto</option>
          <option value="income">Ingreso</option>
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

      <ErrorList errors={errors} />
      <div className="space-y-2">
        <PrimaryButton type="submit">Guardar</PrimaryButton>
        {form.id && <SecondaryButton type="button" onClick={handleDelete} className="border-red-900 text-red-300">Borrar categoría</SecondaryButton>}
      </div>
    </form>
  );
}
