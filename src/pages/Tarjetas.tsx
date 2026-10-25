import { useState } from 'react';
import { Link } from 'react-router-dom';
import CardForm, { EMPTY_CARD } from '../components/CardForm';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';
import { PrimaryButton } from '../components/ui';
import { availableLimit, periodForPurchase, statementSummary } from '../domain/cards';
import { formatDate, formatPeriod, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { useCards, useInstallments, usePayments, useStatements } from '../hooks/useData';

export default function Tarjetas() {
  const cards = useCards();
  const statements = useStatements();
  const installments = useInstallments();
  const payments = usePayments();
  const [creating, setCreating] = useState(false);

  if (creating) return <CardForm draft={EMPTY_CARD} onDone={() => setCreating(false)} />;
  // Sin todos los datos los totales saldrían en cero por un instante.
  if (!cards || !statements || !installments || !payments) return null;

  const active = cards.filter((c) => !c.archived);
  const archived = cards.filter((c) => c.archived);
  const now = today();

  const renderCard = (card: (typeof cards)[number]) => {
    const own = statements.filter((s) => s.cardId === card.id);
    const period = periodForPurchase(card, own, now);
    const summary = statementSummary(card, own, installments, payments, period, now);
    const limit = availableLimit(card, own, installments, payments);
    return (
      <li key={card.id}>
        <Link to={`/tarjetas/${card.id}`} className="block rounded-xl bg-slate-900 p-4 active:bg-slate-800" style={{ borderLeft: `4px solid ${card.color ?? '#475569'}` }}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">{card.name}</span>
            <StatusBadge status={summary.status} />
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-xs text-slate-500">Resumen de {formatPeriod(period)}</p>
              <p className="text-xl font-semibold tabular-nums">{formatMoney(summary.remainingARS)}</p>
              {summary.remainingUSD !== 0 && <p className="text-sm tabular-nums text-slate-300">{formatMoney(summary.remainingUSD, 'USD')}</p>}
              <p className="mt-0.5 text-xs text-slate-500">Cierra {formatDate(summary.closingDate)} · vence {formatDate(summary.dueDate)}</p>
            </div>
            {limit !== undefined && (
              <div className="text-right">
                <p className="text-xs text-slate-500">Límite disponible</p>
                <p className={`text-sm font-medium tabular-nums ${limit < 0 ? 'text-red-400' : ''}`}>{formatMoney(limit)}</p>
              </div>
            )}
          </div>
        </Link>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Tarjetas" />
      {cards.length === 0 ? (
        <EmptyState>Agregá tus tarjetas de crédito con sus días de cierre y vencimiento. Después cargá las compras y las cuotas se reparten solas en los resúmenes.</EmptyState>
      ) : (
        <>
          <ul className="space-y-3">{active.map(renderCard)}</ul>
          {archived.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-slate-500">Archivadas</h2>
              <ul className="space-y-3 opacity-70">{archived.map(renderCard)}</ul>
            </>
          )}
        </>
      )}
      <PrimaryButton type="button" className="mt-6" onClick={() => setCreating(true)}>Nueva tarjeta</PrimaryButton>
    </>
  );
}
