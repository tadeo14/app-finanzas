import { useEffect, useState } from 'react';
import { formatMoney, parseMoney } from '../domain/money';
import type { Currency } from '../domain/types';

/** Formatea centavos para editar: 123450 → "1234,50". */
function toEditable(cents: number | null): string {
  if (cents === null) return '';
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}${abs % 100 ? `,${String(abs % 100).padStart(2, '0')}` : ''}`;
  return cents < 0 ? `-${text}` : text;
}

/**
 * Input de monto con teclado numérico. Mantiene el texto tal cual lo tipea el usuario
 * y avisa hacia afuera el valor en centavos (null si está vacío o es inválido).
 */
export default function MoneyInput({
  value,
  onChange,
  currency,
  large = false,
  autoFocus,
  id,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  currency: Currency;
  large?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const [text, setText] = useState(() => toEditable(value));

  // Si el valor cambia desde afuera (por ejemplo al cargar un movimiento a editar), resincronizar.
  useEffect(() => {
    if (parseMoney(text) !== value) setText(toEditable(value));
  }, [value]);

  const parsed = parseMoney(text);
  const invalid = text.trim() !== '' && parsed === null;

  return (
    <div>
      <div className={`flex items-baseline gap-2 border-b-2 ${invalid ? 'border-red-500' : 'border-slate-700 focus-within:border-emerald-500'}`}>
        <span className={`${large ? 'text-2xl' : 'text-base'} text-slate-400`}>{currency === 'USD' ? 'US$' : '$'}</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseMoney(e.target.value));
          }}
          className={`w-full bg-transparent py-2 font-semibold text-slate-100 placeholder:text-slate-600 focus:outline-none ${
            large ? 'text-4xl' : 'text-xl'
          }`}
        />
      </div>
      {invalid ? (
        <p className="mt-1 text-xs text-red-400">Monto inválido. Usá coma para los decimales.</p>
      ) : parsed !== null && parsed >= 100_000 ? (
        <p className="mt-1 text-xs text-slate-500">{formatMoney(parsed, currency)}</p>
      ) : null}
    </div>
  );
}
