import { useState } from 'react';
import { type StatementSummary } from '../domain/cards';
import { formatPeriod, today } from '../domain/dates';
import { formatMoney } from '../domain/money';
import { allocatePayment, paymentAccountAmount, validatePayment } from '../domain/payments';
import type { Account, Card, Installment, Statement, StatementPayment } from '../domain/types';
import { ValidationError } from '../db/errors';
import { payStatement } from '../db/paymentsRepo';
import { db } from '../db/schema';
import { useSettings } from '../hooks/useData';
import MoneyInput from './MoneyInput';
import { ErrorList, Field, inputClass, PrimaryButton } from './ui';

/** Formulario para pagar un resumen, total o parcial. Arranca con lo que falta pagar. */
export default function PayStatement({
  card, period, summary, accounts, statements, installments, payments, onDone,
}: {
  card: Card;
  period: string;
  summary: StatementSummary;
  accounts: Account[];
  statements: Statement[];
  installments: Installment[];
  payments: StatementPayment[];
  /** Recibe el texto de confirmación para mostrar en el resumen. */
  onDone: (message: string) => void;
}) {
  const usable = accounts.filter((a) => !a.archived);
  const settings = useSettings();
  const [accountId, setAccountId] = useState(
    () => usable.find((a) => a.id === card.defaultPaymentAccountId)?.id ?? usable.find((a) => a.currency === 'ARS')?.id ?? usable[0]?.id ?? '',
  );
  const [date, setDate] = useState(today());
  const [amountARS, setAmountARS] = useState<number | null>(Math.max(0, summary.remainingARS) || null);
  // El saldo en dólares se precarga solo si se paga desde una cuenta en dólares; con una cuenta en
  // pesos es opcional, porque obliga a indicar una cotización.
  const defaultUSD = Math.max(0, summary.remainingUSD) || null;
  const [amountUSD, setAmountUSD] = useState<number | null>(
    usable.find((a) => a.id === accountId)?.currency === 'USD' ? defaultUSD : null,
  );
  const [rate, setRate] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const account = usable.find((a) => a.id === accountId);
  const owesUSD = summary.remainingUSD > 0;
  const payingUSD = (amountUSD ?? 0) > 0;
  const needsRate = account?.currency === 'ARS' && payingUSD;
  // El tipo de cambio se tipea en pesos por dólar; si no lo cargó, se sugiere el de referencia de Más.
  const exchangeRate = rate !== null ? rate / 100 : settings?.usdRate;

  const draft = {
    amountARS: account?.currency === 'USD' ? 0 : amountARS ?? 0,
    amountUSD: amountUSD ?? 0,
    exchangeRate: needsRate ? exchangeRate : undefined,
  };
  const withdrawn = account && validatePayment(draft, account, summary).length === 0 ? paymentAccountAmount(draft, account) : null;

  // Aviso de qué parte salda resúmenes anteriores vencidos.
  let olderPart = 0;
  let olderPeriods: string[] = [];
  try {
    const chunks = allocatePayment(card, statements, installments, payments, period, draft.amountARS, draft.amountUSD, today());
    const older = chunks.filter((c) => c.period !== period);
    olderPart = older.reduce((sum, c) => sum + c.amountARS, 0);
    olderPeriods = older.map((c) => formatPeriod(c.period));
  } catch {
    // el monto supera la deuda: lo informa validatePayment al guardar
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const chunks = allocatePayment(card, statements, installments, payments, period, draft.amountARS, draft.amountUSD, today());
      await payStatement(db, { cardId: card.id, period, accountId, date, ...draft });
      const where = chunks.map((c) => formatPeriod(c.period)).join(' y ');
      onDone(`Pago registrado: ${formatMoney(withdrawn ?? 0, account?.currency ?? 'ARS')} desde ${account?.name ?? 'la cuenta'}. Se aplicó a ${where}.`);
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : error instanceof RangeError ? [error.message] : ['No se pudo registrar el pago.']);
    } finally {
      setSaving(false);
    }
  }

  if (usable.length === 0) {
    return <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-400">Para pagar un resumen primero creá una cuenta en Más → Cuentas.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl bg-slate-900 p-4">
      <h2 className="font-medium">Pagar resumen de {formatPeriod(period)}</h2>

      <Field label="Pagar desde">
        <select className={inputClass} value={accountId} onChange={(e) => {
          setAccountId(e.target.value);
          setAmountUSD(usable.find((a) => a.id === e.target.value)?.currency === 'USD' ? defaultUSD : null);
        }}>
          {usable.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
      </Field>

      {account?.currency !== 'USD' && summary.remainingARS > 0 && (
        <Field label="Monto en pesos"><MoneyInput value={amountARS} onChange={setAmountARS} currency="ARS" /></Field>
      )}
      {owesUSD && (
        <Field label="Monto en dólares"><MoneyInput value={amountUSD} onChange={setAmountUSD} currency="USD" /></Field>
      )}
      {owesUSD && account?.currency === 'ARS' && !payingUSD && (
        <p className="-mt-2 text-xs text-slate-500">Debés {formatMoney(summary.remainingUSD, 'USD')}. Podés pagarlos con pesos (ingresá el monto y la cotización) o desde una cuenta en dólares.</p>
      )}
      {needsRate && (
        <Field label="Cotización (pesos por dólar)">
          <MoneyInput value={rate ?? (settings?.usdRate ? Math.round(settings.usdRate * 100) : null)} onChange={setRate} currency="ARS" />
        </Field>
      )}
      <Field label="Fecha"><input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>

      {olderPart > 0 && (
        <p className="rounded-xl bg-amber-950/50 p-3 text-xs text-amber-200">
          {formatMoney(olderPart)} de este pago salda el saldo vencido de {olderPeriods.join(' y ')}.
        </p>
      )}
      {withdrawn !== null && account && (
        <p className="text-sm text-slate-300">Se descuentan <strong>{formatMoney(withdrawn, account.currency)}</strong> de {account.name}.</p>
      )}

      <ErrorList errors={errors} />
      <PrimaryButton type="submit" disabled={saving}>Registrar pago</PrimaryButton>
    </form>
  );
}
