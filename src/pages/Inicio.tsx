import { Link } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import { filterTransactions, incomeAndExpense, totalsByCurrency } from '../domain/accounts';
import { formatPeriod, periodOf, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { CARD_PAYMENT_CATEGORY_ID } from '../db/seed';
import { useAccounts, useBalances, useTransactions } from '../hooks/useData';

export default function Inicio() {
  const accounts = useAccounts();
  const transactions = useTransactions();
  const balances = useBalances(accounts, transactions);

  if (!accounts) return null;
  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Inicio" />
        <EmptyState>
          Todavía no hay datos. Empezá <Link to="/mas/cuentas" className="text-emerald-400 underline">creando una cuenta</Link>.
        </EmptyState>
      </>
    );
  }

  const totals = totalsByCurrency(accounts, balances);
  const month = periodOf(today());
  const flows = incomeAndExpense(
    filterTransactions(transactions ?? [], { month }),
    accounts,
    new Set([CARD_PAYMENT_CATEGORY_ID]),
  );

  return (
    <>
      <PageHeader title="Inicio" />
      <section className="rounded-xl bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Saldo total</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(totals.ARS, 'ARS')}</p>
        {totals.USD !== 0 && <p className="mt-1 text-lg tabular-nums text-slate-300">{formatMoney(totals.USD, 'USD')}</p>}
      </section>

      <section className="mt-3 rounded-xl bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">{formatPeriod(month)}</p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-slate-500">Ingresos</p>
            <p className="font-semibold tabular-nums text-emerald-400">{formatMoney(flows.ARS.income)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Gastos</p>
            <p className="font-semibold tabular-nums">{formatMoney(flows.ARS.expense)}</p>
          </div>
        </div>
      </section>
    </>
  );
}
