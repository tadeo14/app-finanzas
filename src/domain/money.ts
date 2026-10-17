// Utilidades de dinero. Todo monto es un entero en centavos; los floats solo aparecen al parsear texto.
import type { Currency } from './types';

const CURRENCY_SYMBOL: Record<Currency, string> = { ARS: '$', USD: 'US$' };

/** Agrega separador de miles '.' a una cadena de dígitos. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 123456 → "$ 1.234,56" (formato es-AR). Formateo manual para no depender del ICU del navegador. */
export function formatMoney(cents: number, currency: Currency = 'ARS'): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const units = Math.floor(abs / 100);
  const decimals = String(abs % 100).padStart(2, '0');
  return `${sign}${CURRENCY_SYMBOL[currency]} ${groupThousands(String(units))},${decimals}`;
}

/** Igual que formatMoney pero sin decimales cuando son ,00 (para previews y gráficos). */
export function formatMoneyShort(cents: number, currency: Currency = 'ARS'): string {
  const full = formatMoney(cents, currency);
  return full.endsWith(',00') ? full.slice(0, -3) : full;
}

/**
 * Parsea lo que tipea el usuario a centavos. Acepta formato argentino ("1.234,56", "1234,5")
 * y, si no hay coma, un punto seguido de 1 o 2 dígitos se toma como decimal ("1234.56").
 * Devuelve null si el texto no es un monto válido.
 */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/^(US)?\$\s*/i, '').replace(/\s/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '') return null;

  let intPart: string;
  let decPart = '';
  if (s.includes(',')) {
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    intPart = parts[0]!;
    decPart = parts[1]!;
    if (!/^\d{1,3}(\.\d{3})*$|^\d*$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, '');
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, decPart] = s.split('.') as [string, string];
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) {
    intPart = s.replace(/\./g, '');
  } else {
    return null;
  }

  if (!/^\d{0,2}$/.test(decPart)) return null;
  if (intPart === '' && decPart === '') return null;
  const cents = Number(intPart || '0') * 100 + Number(decPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/** Reparte un total en n partes enteras; el resto por redondeo va a la primera (SPEC §4.3). */
export function splitEvenly(total: number, n: number): number[] {
  assertCents(total);
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`n inválido: ${n}`);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const parts = Array.from({ length: n }, () => base * sign);
  parts[0] = (base + (abs - base * n)) * sign;
  return parts;
}

/** Convierte centavos de una moneda a otra con una cotización, redondeando al centavo. */
export function convert(cents: number, rate: number): number {
  assertCents(cents);
  if (!(rate > 0)) throw new RangeError(`cotización inválida: ${rate}`);
  return Math.round(cents * rate);
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

export function assertCents(value: number): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`monto no entero en centavos: ${value}`);
}
