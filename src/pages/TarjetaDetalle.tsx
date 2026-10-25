import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import CardForm from '../components/CardForm';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton, Segmented } from '../components/ui';
import {
  activePurchases,
  advanceInstallments,
  availableLimit,
  futureCommitments,
  periodForPurchase,
  statementSummary,
  type ActivePurchase,
} from '../domain/cards';
import { addMonths, formatDate, formatPeriod, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import type { Card, CardPurchase, Category, Installment } from '../domain/types';
import { advancePurchase, saveStatementDates } from '../db/cardsRepo';
import { ValidationError } from '../db/repo';
import { db } from '../db/schema';
import { useCard, useCategories, useInstallments, usePayments, usePurchases, useStatements } from '../hooks/useData';

type Tab = 'resumen' | 'cuotas' | 'futuro';

export default function TarjetaDetalle() {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const card = useCard(cardId);
  const statements = useStatements(cardId) ?? [];
  const installments = useInstallments(cardId) ?? [];
  const purchases = usePurchases(cardId) ?? [];
  const payments = usePayments() ?? [];
  const categories = useCategories();
  const [tab, setTab] = useState<Tab>('resumen');
  const [period, setPeriod] = useState<string>();
  const [editingCard, setEditingCard] = useState(false);

  if (card === null) {
    return <p className="py-10 text-center text-slate-400">Esa tarjeta no existe. <Link to="/tarjetas" className="text-emerald-400">Volver</Link></p>;
  }
  if (!card) return null;
  if (editingCard) {
    return <CardForm draft={card} onDone={() => setEditingCard(false)} onDeleted={() => navigate('/tarjetas', { replace: true })} />;
  }

  const now = today();
  // El resumen "actual" es el que recibiría una compra de hoy.
  const currentPeriod = periodForPurchase(card, statements, now);
  const shown = period ?? currentPeriod;
  const limit = availableLimit(card, statements, installments, payments);

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/tarjetas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold">{card.name}</h1>
          {limit !== undefined && (
            <p className="text-xs text-slate-500">Límite disponible <span className={limit < 0 ? 'text-red-400' : 'text-slate-300'}>{formatMoney(limit)}</span></p>
          )}
        </div>
        <button type="button" onClick={() => setEditingCard(true)} className="rounded-lg px-3 py-2 text-sm text-slate-300 active:bg-slate-800">Editar</button>
      </div>

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'resumen', label: 'Resumen' },
          { value: 'cuotas', label: 'Cuotas' },
          { value: 'futuro', label: 'Futuro' },
        ]}
      />

      <div className="mt-4">
        {tab === 'resumen' && (
          <StatementView card={card} period={shown} onPeriod={setPeriod} statements={statements} installments={installments} purchases={purchases} payments={payments} categories={categories} />
        )}
        {tab === 'cuotas' && <PendingPurchases currentPeriod={currentPeriod} purchases={purchases} installments={installments} />}
        {tab === 'futuro' && <FutureCommitments currentPeriod={currentPeriod} installments={installments} />}
      </div>
    </>
  );
}

function StatementView({
  card, period, onPeriod, statements, installments, purchases, payments, categories,
}: {
  card: Card;
  period: string;
  onPeriod: (p: string) => void;
  statements: ReturnType<typeof useStatements> & object;
  installments: Installment[];
  purchases: CardPurchase[];
  payments: NonNullable<ReturnType<typeof usePayments>>;
  categories: Category[];
}) {
  const [editingDates, setEditingDates] = useState(false);
  const summary = statementSummary(card, statements, installments, payments, period, today());
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const advancedKeys = new Set(installments.filter((i) => i.status === 'cancelled').map((i) => `${i.purchaseId}:${i.number}`));
  const rows = installments
    .filter((i) => i.period === period && i.status === 'scheduled')
    .sort((a, b) => (purchaseById.get(a.purchaseId)?.date ?? '').localeCompare(purchaseById.get(b.purchaseId)?.date ?? ''));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-slate-900 px-2 py-1">
        <button type="button" aria-label="Resumen anterior" onClick={() => onPeriod(addMonths(period, -1))} className="px-3 py-2 text-xl text-slate-300">←</button>
        <span className="font-medium">{formatPeriod(period)}</span>
        <button type="button" aria-label="Resumen siguiente" onClick={() => onPeriod(addMonths(period, 1))} className="px-3 py-2 text-xl text-slate-300">→</button>
      </div>

      <section className="rounded-xl bg-slate-900 p-4">
        <div className="flex items-center justify-between">
          <StatusBadge status={summary.status} />
          <button type="button" onClick={() => setEditingDates(!editingDates)} className="text-sm text-emerald-400">
            {editingDates ? 'Cerrar' : 'Editar fechas'}
          </button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-slate-500">Cierre</dt><dd>{formatDate(summary.closingDate)}</dd></div>
          <div><dt className="text-xs text-slate-500">Vencimiento</dt><dd>{formatDate(summary.dueDate)}</dd></div>
        </dl>
        {editingDates && (
          <DatesForm key={`${card.id}-${period}-${summary.closingDate}-${summary.dueDate}`} cardId={card.id} period={period} closingDate={summary.closingDate} dueDate={summary.dueDate} onDone={() => setEditingDates(false)} />
        )}
      </section>

      <section className="rounded-xl bg-slate-900 p-4 text-sm">
        <Line label="Compras del resumen" ars={summary.totalARS} usd={summary.totalUSD} />
        {(summary.previousBalanceARS !== 0 || summary.previousBalanceUSD !== 0) && (
          <Line label="Saldo anterior" ars={summary.previousBalanceARS} usd={summary.previousBalanceUSD} />
        )}
        {(summary.paidARS !== 0 || summary.paidUSD !== 0) && <Line label="Pagos" ars={-summary.paidARS} usd={-summary.paidUSD} />}
        <div className="mt-2 border-t border-slate-800 pt-2">
          <Line label="Total a pagar" ars={summary.remainingARS} usd={summary.remainingUSD} strong />
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState>No hay compras en este resumen. Cargalas con el botón +, eligiendo "Tarjeta".</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl bg-slate-900">
          {rows.map((i) => {
            const purchase = purchaseById.get(i.purchaseId);
            const category = categoryById.get(i.categoryId);
            const title = purchase?.description || category?.name || 'Compra';
            const isAdvance = advancedKeys.has(`${i.purchaseId}:${i.number}`);
            return (
              <li key={i.id}>
                <Link to={`/compras/${i.purchaseId}`} className="flex items-center gap-3 px-3 py-3 active:bg-slate-800">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-lg">{category?.icon ?? '•'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {i.of > 1 ? `${i.number}/${i.of}` : '1 pago'}{isAdvance ? ' · adelanto' : ''} · {category?.name ?? 'Sin categoría'}
                    </span>
                  </span>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${i.amount < 0 ? 'text-emerald-400' : ''}`}>{formatMoney(i.amount, i.currency)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Line({ label, ars, usd, strong = false }: { label: string; ars: number; usd: number; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-1 ${strong ? 'font-semibold' : 'text-slate-300'}`}>
      <span>{label}</span>
      <span className="text-right tabular-nums">
        {formatMoney(ars)}
        {usd !== 0 && <span className="block text-xs text-slate-400">{formatMoney(usd, 'USD')}</span>}
      </span>
    </div>
  );
}

function DatesForm({ cardId, period, closingDate, dueDate, onDone }: { cardId: string; period: string; closingDate: string; dueDate: string; onDone: () => void }) {
  const [closing, setClosing] = useState(closingDate);
  const [due, setDue] = useState(dueDate);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSave() {
    try {
      await saveStatementDates(db, cardId, period, closing, due);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cierre"><input type="date" className={inputClass} value={closing} onChange={(e) => setClosing(e.target.value)} /></Field>
        <Field label="Vencimiento"><input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </div>
      <p className="text-xs text-slate-500">Si cambiás el cierre, las compras que queden de un lado u otro se pasan al resumen que corresponde.</p>
      <ErrorList errors={errors} />
      <PrimaryButton type="button" onClick={handleSave}>Guardar fechas</PrimaryButton>
    </div>
  );
}

function PendingPurchases({ currentPeriod, purchases, installments }: { currentPeriod: string; purchases: CardPurchase[]; installments: Installment[] }) {
  const active = activePurchases(purchases, installments, currentPeriod);
  const [advancing, setAdvancing] = useState<string>();

  if (active.length === 0) {
    return <EmptyState>No tenés compras en cuotas pendientes en esta tarjeta.</EmptyState>;
  }
  return (
    <ul className="space-y-3">
      {active.map((a) => (
        <li key={a.purchase.id} className="rounded-xl bg-slate-900 p-4">
          <PendingRow active={a} currency={a.purchase.currency} advancing={advancing === a.purchase.id} onToggle={() => setAdvancing(advancing === a.purchase.id ? undefined : a.purchase.id)} installments={installments} currentPeriod={currentPeriod} />
        </li>
      ))}
    </ul>
  );
}

function PendingRow({ active, currency, advancing, onToggle, installments, currentPeriod }: {
  active: ActivePurchase; currency: CardPurchase['currency']; advancing: boolean; onToggle: () => void; installments: Installment[]; currentPeriod: string;
}) {
  const { purchase } = active;
  const progress = Math.round(((active.currentNumber - 1) / purchase.installments) * 100);
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/compras/${purchase.id}`} className="block truncate font-medium">{purchase.description || 'Compra'}</Link>
          <p className="text-xs text-slate-500">Cuota {active.currentNumber} de {purchase.installments} · última en {formatPeriod(active.lastPeriod)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-500">Restan</p>
          <p className="font-semibold tabular-nums">{formatMoney(active.remaining, currency)}</p>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
      </div>
      <SecondaryButton type="button" className="mt-3" onClick={onToggle}>{advancing ? 'Cancelar' : 'Adelantar cuotas'}</SecondaryButton>
      {advancing && <AdvanceForm purchaseId={purchase.id} currency={currency} installments={installments.filter((i) => i.purchaseId === purchase.id)} currentPeriod={currentPeriod} lastPeriod={active.lastPeriod} onDone={onToggle} />}
    </>
  );
}

function AdvanceForm({ purchaseId, currency, installments, currentPeriod, lastPeriod, onDone }: {
  purchaseId: string; currency: CardPurchase['currency']; installments: Installment[]; currentPeriod: string; lastPeriod: string; onDone: () => void;
}) {
  // Se puede adelantar a cualquier resumen desde el actual hasta el anterior a la última cuota.
  const options: string[] = [];
  for (let p = currentPeriod; p < lastPeriod; p = addMonths(p, 1)) options.push(p);
  const [target, setTarget] = useState(options[0] ?? currentPeriod);
  const [errors, setErrors] = useState<string[]>([]);

  let preview = '';
  try {
    const { cancelledIds, merged } = advanceInstallments(installments, target, () => 'preview');
    const count = cancelledIds.length;
    preview = `${count === 1 ? 'Se paga 1 cuota' : `Se pagan ${count} cuotas juntas`} (${formatMoney(merged.amount, currency)}) en el resumen de ${formatPeriod(target)}.`;
  } catch {
    preview = 'No quedan cuotas posteriores a ese resumen.';
  }

  async function handleConfirm() {
    try {
      await advancePurchase(db, purchaseId, target);
      onDone();
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo adelantar.']);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
      <Field label="Pagarlas en el resumen de">
        <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
          {options.map((p) => <option key={p} value={p}>{formatPeriod(p)}</option>)}
        </select>
      </Field>
      <p className="text-sm text-slate-300">{preview}</p>
      <ErrorList errors={errors} />
      <PrimaryButton type="button" onClick={handleConfirm} disabled={options.length === 0}>Confirmar adelanto</PrimaryButton>
    </div>
  );
}

function FutureCommitments({ currentPeriod, installments }: { currentPeriod: string; installments: Installment[] }) {
  const months = futureCommitments(installments, currentPeriod, 12);
  const max = Math.max(1, ...months.map((m) => Math.abs(m.totalARS)));
  const hasAny = months.some((m) => m.totalARS !== 0 || m.totalUSD !== 0);

  if (!hasAny) return <EmptyState>No tenés cuotas programadas en los próximos 12 meses.</EmptyState>;
  return (
    <section className="rounded-xl bg-slate-900 p-4">
      <h2 className="mb-3 text-sm font-medium text-slate-300">Cuotas de los próximos 12 meses</h2>
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
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(Math.abs(m.totalARS) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
