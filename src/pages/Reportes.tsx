import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS, GRID, OTHER, SERIES, SURFACE } from '../components/chartColors';
import EmptyState from '../components/EmptyState';
import MonthSelector from '../components/MonthSelector';
import PageHeader from '../components/PageHeader';
import { formatPeriod, periodOf, today } from '../domain/dates';
import { formatCompact, formatMoney } from '../domain/money';
import { entriesForMonth, expensesByCategory, monthlySeries, NO_CATEGORY, sliceRows } from '../domain/reports';
import { useCategories } from '../hooks/useData';
import { useReportSources } from '../hooks/useReport';

const SHORT_MONTH = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (period: string) => SHORT_MONTH[Number(period.slice(5)) - 1] ?? period;

const card = 'rounded-xl bg-slate-900 p-4';
const caption = 'text-xs uppercase tracking-wide text-slate-400';

export default function Reportes() {
  const { src, usdRate } = useReportSources();
  const [month, setMonth] = useState(() => periodOf(today()));

  if (!src) return null;
  return (
    <>
      <PageHeader title="Reportes" />
      <div className="space-y-3">
        <section className={card}>
          <MonthSelector value={month} onChange={setMonth} />
          <ExpensesByCategory month={month} usdRate={usdRate} />
        </section>
        <Evolution endMonth={periodOf(today())} usdRate={usdRate} />
      </div>
    </>
  );
}

// ---------- Gastos por categoría (dona + lista con drill-down) ----------

interface Slice {
  key: string;
  name: string;
  icon?: string;
  amount: number;
  drillId?: string;
}

function ExpensesByCategory({ month, usdRate }: { month: string; usdRate?: number }) {
  const { src } = useReportSources();
  const categories = useCategories();
  const [drill, setDrill] = useState<string>();

  const model = useMemo(() => {
    if (!src) return null;
    const { expense } = entriesForMonth(src, month);
    return expensesByCategory(expense, categories, usdRate);
  }, [src, month, categories, usdRate]);

  if (!model) return null;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (id: string) => (id === NO_CATEGORY ? 'Sin categoría' : byId.get(id)?.name ?? 'Categoría borrada');
  const iconOf = (id: string) => (id === NO_CATEGORY ? '❔' : byId.get(id)?.icon);

  // Con drill-down se muestran las subcategorías de la categoría elegida (más lo cargado directo en ella).
  const root = drill ? model.rows.find((r) => r.categoryId === drill) : undefined;
  const all: Slice[] = root
    ? [
        ...root.children.map((c) => ({ key: c.categoryId, name: nameOf(c.categoryId), icon: iconOf(c.categoryId), amount: c.amount })),
        ...(root.own !== 0 ? [{ key: `${root.categoryId}-own`, name: `${nameOf(root.categoryId)} (general)`, icon: iconOf(root.categoryId), amount: root.own }] : []),
      ].sort((a, b) => b.amount - a.amount)
    : model.rows.map((r) => ({
        key: r.categoryId,
        name: nameOf(r.categoryId),
        icon: iconOf(r.categoryId),
        amount: r.amount,
        drillId: r.children.length > 0 ? r.categoryId : undefined,
      }));
  const total = root ? root.amount : model.total;
  const { items, othersAmount, othersCount } = sliceRows(all);
  const slices: (Slice & { color: string })[] = [
    ...items.map((s, i) => ({ ...s, color: SERIES[i] ?? OTHER })),
    ...(othersCount > 0 ? [{ key: 'others', name: `Otros (${othersCount})`, amount: othersAmount, color: OTHER }] : []),
  ];

  return (
    <div className="mt-4">
      <h2 className={caption}>{root ? `Gastos en ${nameOf(root.categoryId)}` : 'Gastos por categoría'}</h2>

      {model.skippedUSD && (
        <p className="mt-2 rounded-lg bg-amber-950/50 p-2 text-xs text-amber-200">
          Hay gastos en dólares que no se incluyen. <Link to="/mas/cotizacion" className="underline">Cargá la cotización</Link> para sumarlos.
        </p>
      )}

      {slices.length === 0 ? (
        <div className="mt-3">
          <EmptyState>No hay gastos en {formatPeriod(month)}.</EmptyState>
        </div>
      ) : (
        <>
          {root && (
            <button type="button" onClick={() => setDrill(undefined)} className="mt-2 text-sm text-emerald-400">
              ‹ Todas las categorías
            </button>
          )}
          <div className="relative mt-2 h-56" role="img" aria-label={`Gastos de ${formatPeriod(month)} por categoría. Total ${formatMoney(total)}. El detalle está en la lista de abajo.`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius={62}
                  outerRadius={92}
                  stroke={SURFACE}
                  strokeWidth={2}
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  onClick={(slice) => {
                    const target = slices.find((s) => s.key === (slice as { key?: string }).key);
                    if (target?.drillId) setDrill(target.drillId);
                  }}
                >
                  {slices.map((s) => (
                    <Cell key={s.key} fill={s.color} style={{ cursor: s.drillId ? 'pointer' : 'default', outline: 'none' }} />
                  ))}
                </Pie>
                <Tooltip content={<MoneyTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xs text-slate-400">Total</span>
              <span className="text-lg font-semibold tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>

          <ul className="mt-2 divide-y divide-slate-800">
            {slices.map((s) => {
              const percent = total > 0 ? Math.round((s.amount / total) * 100) : 0;
              const row = (
                <>
                  <span aria-hidden className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                  <span aria-hidden className="w-5 text-center">{s.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-left text-sm">{s.name}</span>
                  <span className="text-sm tabular-nums">{formatMoney(s.amount)}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-slate-500">{percent}%</span>
                  {s.drillId && <span aria-hidden className="text-slate-600">›</span>}
                </>
              );
              return (
                <li key={s.key}>
                  {s.drillId ? (
                    <button type="button" onClick={() => setDrill(s.drillId)} className="flex w-full items-center gap-2 py-3 active:bg-slate-800/60">{row}</button>
                  ) : (
                    <div className="flex items-center gap-2 py-3">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {!root && slices.some((s) => s.drillId) && <p className="mt-1 text-xs text-slate-500">Tocá una categoría con › para ver sus subcategorías.</p>}
        </>
      )}
    </div>
  );
}

// ---------- Evolución mensual (barras agrupadas) ----------

function Evolution({ endMonth, usdRate }: { endMonth: string; usdRate?: number }) {
  const { src } = useReportSources();
  const [includeFuture, setIncludeFuture] = useState(false);
  const [asTable, setAsTable] = useState(false);

  const model = useMemo(() => (src ? monthlySeries(src, endMonth, usdRate, 12, includeFuture ? 6 : 0) : null), [src, endMonth, usdRate, includeFuture]);
  if (!model) return null;
  const data = model.points;
  const hasData = data.some((p) => p.income !== 0 || p.expense !== 0);

  return (
    <section className={card}>
      <h2 className={caption}>Ingresos vs gastos, mes a mes</h2>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex gap-4 text-sm">
          <li className="flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: SERIES[0] }} />Ingresos</li>
          <li className="flex items-center gap-2"><span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: SERIES[1] }} />Gastos</li>
        </ul>
        <button type="button" onClick={() => setAsTable(!asTable)} className="text-sm text-emerald-400">{asTable ? 'Ver gráfico' : 'Ver como tabla'}</button>
      </div>

      <label className="mt-3 flex items-center gap-3 text-sm text-slate-300">
        <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
        Incluir cuotas futuras (próximos 6 meses)
      </label>
      {model.skippedUSD && (
        <p className="mt-2 rounded-lg bg-amber-950/50 p-2 text-xs text-amber-200">
          Hay movimientos en dólares que no se incluyen. <Link to="/mas/cotizacion" className="underline">Cargá la cotización</Link>.
        </p>
      )}

      {!hasData ? (
        <div className="mt-3"><EmptyState>Todavía no hay movimientos para graficar.</EmptyState></div>
      ) : asTable ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Ingresos y gastos por mes</caption>
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 font-medium">Mes</th>
                <th className="py-2 text-right font-medium">Ingresos</th>
                <th className="py-2 text-right font-medium">Gastos</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 tabular-nums">
              {data.map((p) => (
                <tr key={p.month}>
                  <th scope="row" className="py-2 text-left font-normal text-slate-300">{formatPeriod(p.month)}{p.projected ? ' *' : ''}</th>
                  <td className="py-2 text-right">{formatMoney(p.income)}</td>
                  <td className="py-2 text-right">{formatMoney(p.expense)}</td>
                  <td className={`py-2 text-right ${p.income - p.expense < 0 ? 'text-red-300' : ''}`}>{formatMoney(p.income - p.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {includeFuture && <p className="mt-2 text-xs text-slate-500">* Mes futuro: solo cuenta las cuotas ya programadas.</p>}
        </div>
      ) : (
        <>
          <div className="mt-3 h-64" role="img" aria-label="Ingresos y gastos de los últimos 12 meses. Los mismos valores están disponibles como tabla.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                {/* Con 18 meses no entran todas las etiquetas: se muestra una de cada dos (el tooltip tiene el mes completo). */}
                <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} interval={data.length > 12 ? 1 : 0} />
                <YAxis tickFormatter={(v: number) => formatCompact(v).replace(' ', '\u00a0')} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.06)' }} content={<EvolutionTooltip />} />
                <Bar dataKey="income" name="Ingresos" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                  {data.map((p) => <Cell key={p.month} fill={SERIES[0]} fillOpacity={p.projected ? 0.3 : 1} stroke={SERIES[0]} strokeWidth={p.projected ? 1.5 : 0} />)}
                </Bar>
                <Bar dataKey="expense" name="Gastos" fill={SERIES[1]} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false}>
                  {data.map((p) => <Cell key={p.month} fill={SERIES[1]} fillOpacity={p.projected ? 0.3 : 1} stroke={SERIES[1]} strokeWidth={p.projected ? 1.5 : 0} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {includeFuture && <p className="mt-1 text-xs text-slate-500">Las barras con contorno son meses futuros: solo cuentan las cuotas ya programadas.</p>}
        </>
      )}
    </section>
  );
}

// ---------- Tooltips ----------

interface TooltipProps {
  active?: boolean;
  payload?: readonly { name?: string | number; value?: number | string; payload?: { month?: string; projected?: boolean } }[];
}

const tooltipBox = 'rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs shadow-lg';

function MoneyTooltip({ active, payload, total }: TooltipProps & { total: number }) {
  const item = payload?.[0];
  if (!active || !item) return null;
  const value = Number(item.value ?? 0);
  return (
    <div className={tooltipBox}>
      <p className="font-medium">{item.name}</p>
      <p className="tabular-nums">{formatMoney(value)}{total > 0 ? ` · ${Math.round((value / total) * 100)}%` : ''}</p>
    </div>
  );
}

function EvolutionTooltip({ active, payload }: TooltipProps) {
  const first = payload?.[0];
  if (!active || !first) return null;
  const month = first.payload?.month;
  return (
    <div className={tooltipBox}>
      <p className="mb-1 font-medium">{month ? formatPeriod(month) : ''}{first.payload?.projected ? ' (cuotas programadas)' : ''}</p>
      {payload?.map((p) => (
        <p key={String(p.name)} className="tabular-nums">{p.name}: {formatMoney(Number(p.value ?? 0))}</p>
      ))}
    </div>
  );
}
