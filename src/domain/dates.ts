// Utilidades de fechas sobre strings 'YYYY-MM-DD' y períodos 'YYYY-MM'.
// Nunca se usa new Date('YYYY-MM-DD') (lo interpreta como UTC y corre el día); la aritmética
// se hace con Date.UTC, que no depende de la zona horaria del dispositivo.

export const TIME_ZONE = 'America/Argentina/Buenos_Aires';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_RE = /^(\d{4})-(\d{2})$/;

const pad2 = (n: number) => String(n).padStart(2, '0');

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseDate(date: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`fecha inválida: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`fecha inválida: ${date}`);
  }
  return { year, month, day };
}

export function isValidDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

export function parsePeriod(period: string): { year: number; month: number } {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new RangeError(`período inválido: ${period}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`período inválido: ${period}`);
  return { year, month };
}

export function toDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function toPeriod(year: number, month: number): string {
  return `${year}-${pad2(month)}`;
}

/** Fecha con el día dado, o el último día del mes si no existe (31 en febrero → 28/29). */
export function dateInPeriod(period: string, day: number): string {
  const { year, month } = parsePeriod(period);
  return toDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/** '2026-10-17' → '2026-10' */
export function periodOf(date: string): string {
  const { year, month } = parseDate(date);
  return toPeriod(year, month);
}

/** Suma (o resta) meses a un período; maneja el cambio de año. */
export function addMonths(period: string, n: number): string {
  const { year, month } = parsePeriod(period);
  const index = year * 12 + (month - 1) + n;
  return toPeriod(Math.floor(index / 12), (index % 12) + 1);
}

/** Cantidad de meses de `from` a `to` (positivo si `to` es posterior). */
export function monthsBetween(from: string, to: string): number {
  const a = parsePeriod(from);
  const b = parsePeriod(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function addDays(date: string, n: number): string {
  const { year, month, day } = parseDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return toDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Días de `from` a `to` (positivo si `to` es posterior). */
export function diffDays(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000;
}

/** Comparación de fechas o períodos: el formato ISO ordena bien como texto. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Hoy en Buenos Aires, sin importar la zona del dispositivo. */
export function today(now: Date = new Date()): string {
  // en-CA formatea como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** '2026-10-12' → '12/10/2026' */
export function formatDate(date: string): string {
  const { year, month, day } = parseDate(date);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** '2026-10' → 'Octubre 2026' */
export function formatPeriod(period: string): string {
  const { year, month } = parsePeriod(period);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}
