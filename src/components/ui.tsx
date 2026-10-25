// Piezas de UI chicas que se repiten en los formularios.
import type { ReactNode } from 'react';

export const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none';

const labelClass = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400';

/**
 * Campo con rótulo. Para un solo input usa <label>; con `group` (grillas de botones) usa un
 * grupo con nombre accesible, porque un <label> con varios botones activa el primero al tocarlo.
 */
export function Field({ label, children, group = false }: { label: string; children: ReactNode; group?: boolean }) {
  if (group) {
    return (
      <div role="group" aria-label={label}>
        <span className={labelClass}>{label}</span>
        {children}
      </div>
    );
  }
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white active:bg-emerald-700 disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-xl border border-slate-700 py-3 text-sm font-medium text-slate-200 active:bg-slate-800 ${props.className ?? ''}`}
    />
  );
}

export function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <ul role="alert" className="rounded-xl bg-red-950/60 p-3 text-sm text-red-300">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid rounded-xl bg-slate-900 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`rounded-lg py-2 text-sm font-medium disabled:opacity-40 ${
            value === o.value ? 'bg-slate-700 text-white' : 'text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
