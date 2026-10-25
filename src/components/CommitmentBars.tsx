import type { MonthCommitment } from '../domain/cards';
import { formatPeriod } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { SERIES } from './chartColors';

/** Cuotas programadas mes a mes: una sola serie, una sola barra fina por mes con su valor al lado. */
export default function CommitmentBars({ months }: { months: MonthCommitment[] }) {
  const max = Math.max(1, ...months.map((m) => Math.abs(m.totalARS)));
  return (
    <ul className="space-y-2">
      {months.map((m) => (
        <li key={m.period} className="text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">{formatPeriod(m.period)}</span>
            <span className="tabular-nums">
              {formatMoney(m.totalARS)}
              {m.totalUSD !== 0 && <span className="ml-2 text-xs text-slate-400">{formatMoney(m.totalUSD, 'USD')}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(m.totalARS) / max) * 100}%`, background: SERIES[0] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
