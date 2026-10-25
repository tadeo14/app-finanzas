import { Link } from 'react-router-dom';
import BackupReminder from '../components/BackupReminder';
import BudgetMeter from '../components/BudgetMeter';
import CommitmentBars from '../components/CommitmentBars';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { totalsByCurrency } from '../domain/accounts';
import { futureCommitments } from '../domain/cards';
import { consolidateARS, nextDue, type NextDue } from '../domain/dashboard';
import { formatDate, formatPeriod, periodOf, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { budgetProgress, entriesForMonth, sumARS } from '../domain/reports';
import { useAccounts, useBalances, useBudgets, useCards, useCategories, useInstallments, usePayments, useStatements, useTransactions } from '../hooks/useData';
import { useReportSources } from '../hooks/useReport';

const card = 'rounded-xl bg-slate-900 p-4';
const caption = 'text-xs uppercase tracking-wide text-slate-400';

export default function Inicio() {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const cards = useCards();
  const statements = useStatements();
  const installments = useInstallments();
  const payments = usePayments();
  const budgets = useBudgets();
  const categories = useCategories();
  const { src, usdRate } = useReportSources();
  const balances = useBalances(accounts, transactions);

  if (!accounts || !cards || !statements || !installments || !payments || !budgets || !src) return null;
  if (accounts.length === 0 && cards.length === 0) {
    return (
      <>
        <PageHeader title="Inicio" />
        <EmptyState>
          Todavía no hay datos. Empezá <Link to="/mas/cuentas" className="text-emerald-400 underline">creando una cuenta</Link> y
          después cargá tus movimientos con el botón +.
        </EmptyState>
      </>
    );
  }

  const now = today();
  const month = periodOf(now);
  const totals = totalsByCurrency(accounts, balances);
  const consolidated = consolidateARS(totals, usdRate);
  const { income, expense } = entriesForMonth(src, month);
  const incomeTotal = sumARS(income, usdRate);
  const expenseTotal = sumARS(expense, usdRate);
  const dues = cards
    .filter((c) => !c.archived)
    .map((c) => ({ card: c, due: nextDue(c, statements.filter((s) => s.cardId === c.id), installments, payments, now) }))
    .filter((x): x is { card: typeof x.card; due: NextDue } => x.due !== null)
    .sort((a, b) => a.due.dueDate.localeCompare(b.due.dueDate));
  const commitments = futureCommitments(installments, month, 6);
  const hasCommitments = commitments.some((m) => m.totalARS !== 0 || m.totalUSD !== 0);
  const progress = budgetProgress(month, budgets, categories, expense, usdRate);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <div className="space-y-3">
      <PageHeader title="Inicio" />
      <BackupReminder />

      <section className={card}>
        <p className={caption}>Saldo total</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(totals.ARS, 'ARS')}</p>
        {totals.USD !== 0 && <p className="mt-1 text-lg tabular-nums text-slate-300">{formatMoney(totals.USD, 'USD')}</p>}
        {totals.USD !== 0 &&
          (consolidated !== undefined ? (
            <p className="mt-2 text-xs text-slate-500">≈ {formatMoney(consolidated)} en pesos, a {formatMoney(Math.round((usdRate ?? 0) * 100))} por dólar</p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              <Link to="/mas/cotizacion" className="text-emerald-400 underline">Cargá la cotización</Link> para ver el total en pesos.
            </p>
          ))}
      </section>

      <section className={card}>
        <p className={caption}>{formatPeriod(month)}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500">Ingresos</p>
            <p className="font-semibold tabular-nums text-emerald-400">{formatMoney(incomeTotal.total)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Gastos</p>
            <p className="font-semibold tabular-nums">{formatMoney(expenseTotal.total)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Los gastos con tarjeta cuentan en el mes del resumen donde caen sus cuotas.</p>
        {(incomeTotal.skippedUSD || expenseTotal.skippedUSD) && (
          <p className="mt-1 text-xs text-amber-300">
            Hay movimientos en dólares que no se suman. <Link to="/mas/cotizacion" className="underline">Cargá la cotización</Link>.
          </p>
        )}
      </section>

      {dues.length > 0 && (
        <section className={card}>
          <p className={caption}>Tarjetas</p>
          <ul className="mt-2 divide-y divide-slate-800">
            {dues.map(({ card: c, due }) => (
              <li key={c.id}>
                <Link to={`/tarjetas/${c.id}`} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className={`block text-xs ${due.overdue ? 'font-medium text-red-400' : 'text-slate-500'}`}>
                      {due.overdue ? '⛔ ' : ''}
                      {dueText(due)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-semibold tabular-nums">
                    {formatMoney(due.remainingARS)}
                    {due.remainingUSD > 0 && <span className="block text-xs font-normal text-slate-300">{formatMoney(due.remainingUSD, 'USD')}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasCommitments && (
        <section className={card}>
          <p className={`${caption} mb-3`}>Cuotas de los próximos 6 meses</p>
          <CommitmentBars months={commitments} />
        </section>
      )}

      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <p className={caption}>Presupuestos del mes</p>
          <Link to="/mas/presupuestos" className="text-xs text-emerald-400">Editar</Link>
        </div>
        {progress.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no definiste presupuestos. <Link to="/mas/presupuestos" className="text-emerald-400 underline">Definir uno</Link>.
          </p>
        ) : (
          <ul className="space-y-4">
            {progress.map((p) => (
              <li key={p.categoryId}>
                <BudgetMeter progress={p} name={categoryById.get(p.categoryId)?.name ?? 'Categoría'} icon={categoryById.get(p.categoryId)?.icon} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function dueText(due: NextDue): string {
  const date = formatDate(due.dueDate);
  if (due.daysLeft < 0) return `Venció el ${date} (hace ${-due.daysLeft} ${-due.daysLeft === 1 ? 'día' : 'días'})`;
  if (due.daysLeft === 0) return `Vence hoy (${date})`;
  return `Vence el ${date} (en ${due.daysLeft} ${due.daysLeft === 1 ? 'día' : 'días'})`;
}
