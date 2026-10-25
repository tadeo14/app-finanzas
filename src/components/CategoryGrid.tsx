import type { Category } from '../domain/types';

/** Grilla de categorías con íconos para elegir con un toque. Las subcategorías se muestran después de su padre. */
export default function CategoryGrid({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const roots = categories.filter((c) => !c.parentId || !categories.some((p) => p.id === c.parentId));
  const ordered = roots.flatMap((r) => [r, ...categories.filter((c) => c.parentId === r.id)]);

  if (!ordered.length) return <p className="text-sm text-slate-500">No hay categorías de este tipo.</p>;

  return (
    <div className="grid grid-cols-4 gap-2">
      {ordered.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          aria-pressed={value === c.id}
          className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] leading-tight ${
            value === c.id ? 'border-emerald-500 bg-emerald-950/60 text-white' : 'border-slate-800 bg-slate-900 text-slate-300'
          }`}
        >
          <span aria-hidden className="text-xl">
            {c.icon ?? '•'}
          </span>
          <span className="line-clamp-2 text-center">{c.parentId ? `↳ ${c.name}` : c.name}</span>
        </button>
      ))}
    </div>
  );
}
