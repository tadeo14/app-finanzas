import { useState } from 'react';
import { Link } from 'react-router-dom';
import MoneyInput from '../components/MoneyInput';
import { ErrorList, Field, PrimaryButton, SecondaryButton } from '../components/ui';
import { formatMoney } from '../domain/money';
import { saveUsdRate } from '../db/catalogRepo';
import { ValidationError } from '../db/errors';
import { db } from '../db/schema';
import { useSettings } from '../hooks/useData';

export default function Cotizacion() {
  const settings = useSettings();
  if (settings === undefined) return null;
  return <RateForm current={settings.usdRate} />;
}

function RateForm({ current }: { current?: number }) {
  // El input maneja centavos: la cotización es pesos por dólar, así que $ 1.250,50 se guarda como 1250.5.
  const [cents, setCents] = useState<number | null>(current !== undefined ? Math.round(current * 100) : null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    try {
      await saveUsdRate(db, cents === null ? undefined : cents / 100);
      setErrors([]);
      setSaved(true);
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo guardar.']);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Cotización del dólar</h1>
      </div>
      <p className="mb-4 text-sm text-slate-400">
        Es solo una referencia para sumar tus dólares a los totales en pesos del inicio y de los reportes.
        No cambia ningún movimiento: cada pago de tarjeta en dólares usa su propia cotización.
      </p>
      <div className="space-y-4">
        <Field label="Pesos por dólar">
          <MoneyInput value={cents} onChange={(v) => { setCents(v); setSaved(false); }} currency="ARS" large autoFocus />
        </Field>
        {current !== undefined && <p className="text-xs text-slate-500">Guardada: {formatMoney(Math.round(current * 100))} por dólar.</p>}
        <ErrorList errors={errors} />
        {saved && <p role="status" className="rounded-xl bg-emerald-950/60 p-3 text-sm text-emerald-200">Cotización guardada.</p>}
        <PrimaryButton type="button" onClick={handleSave}>Guardar</PrimaryButton>
        {current !== undefined && (
          <SecondaryButton type="button" onClick={() => { setCents(null); void saveUsdRate(db, undefined); }} className="border-red-900 text-red-300">Quitar cotización</SecondaryButton>
        )}
      </div>
    </>
  );
}
