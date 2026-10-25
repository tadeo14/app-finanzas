import { addMonths, formatPeriod } from '../domain/dates';

export default function MonthSelector({ value, onChange }: { value: string; onChange: (period: string) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-900 px-2 py-1">
      <button type="button" aria-label="Mes anterior" onClick={() => onChange(addMonths(value, -1))} className="px-3 py-2 text-xl text-slate-300">
        ‹
      </button>
      <span className="font-medium">{formatPeriod(value)}</span>
      <button type="button" aria-label="Mes siguiente" onClick={() => onChange(addMonths(value, 1))} className="px-3 py-2 text-xl text-slate-300">
        ›
      </button>
    </div>
  );
}
