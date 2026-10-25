import type { BudgetLevel, BudgetProgress } from '../domain/reports';
import { formatMoney } from '../domain/money';
import { useResolvedTheme } from '../theme';
import { chartColors } from './chartColors';

const LEVEL: Record<BudgetLevel, { icon: string; label: string }> = {
  ok: { icon: '', label: '' },
  warning: { icon: '⚠', label: 'Más del 80%' },
  over: { icon: '⛔', label: 'Superado' },
};

/** Medidor de un presupuesto. El estado va con ícono y texto, no solo con color. */
export default function BudgetMeter({ progress, name, icon }: { progress: BudgetProgress; name: string; icon?: string }) {
  const palette = chartColors(useResolvedTheme());
  const color = { ok: palette.series[0]!, warning: palette.warning, over: palette.critical }[progress.level];
  const { icon: statusIcon, label } = LEVEL[progress.level];
  const percent = Math.round(progress.ratio * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span aria-hidden>{icon} </span>
          {name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-400">
          {formatMoney(progress.spent)} de {formatMoney(progress.budget)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name}: ${percent}% del presupuesto`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800"
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {percent}%{label && (
          <span className="ml-2 font-medium" style={{ color }}>
            <span aria-hidden>{statusIcon} </span>
            {label}
          </span>
        )}
      </p>
    </div>
  );
}
