import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorList, Field, inputClass, PrimaryButton, SecondaryButton } from '../components/ui';
import { parseCSV } from '../domain/csvParse';
import { formatDate } from '../domain/dates';
import {
  buildImportPlan,
  detectMapping,
  EMPTY_MAPPING,
  guessMappingFromData,
  importTemplateCSV,
  looksLikeHeader,
  type ColumnMapping,
  type DateFormat,
  type DecimalMark,
  type ImportField,
  type ImportOptions,
  type PlanItem,
} from '../domain/importMovements';
import { formatMoney } from '../domain/money';
import { ValidationError } from '../db/errors';
import { downloadFile } from '../db/files';
import { importMovements, MAX_IMPORT_ROWS, undoImport, type ImportResult } from '../db/importRepo';
import { db } from '../db/schema';
import { useAccounts, useCategories, useTransactions } from '../hooks/useData';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const FIELDS: { field: ImportField; label: string; optional?: boolean; hint?: string }[] = [
  { field: 'date', label: 'Fecha' },
  { field: 'description', label: 'Descripción', optional: true },
  { field: 'amount', label: 'Monto', hint: 'Si el archivo separa débitos y créditos, dejalo sin columna y completá esos dos.' },
  { field: 'category', label: 'Categoría', optional: true },
  { field: 'type', label: 'Tipo (gasto / ingreso)', optional: true, hint: 'Si no hay, el signo del monto decide: negativo es gasto.' },
  { field: 'account', label: 'Cuenta', optional: true },
  { field: 'currency', label: 'Moneda', optional: true },
  { field: 'debit', label: 'Débito (gastos)', optional: true },
  { field: 'credit', label: 'Crédito (ingresos)', optional: true },
];

interface Loaded {
  name: string;
  rows: string[][];
  delimiter: string;
}

/** Lo mínimo para poder importar: una fecha y algún monto. */
const isResolved = (m: ColumnMapping): boolean => m.date !== null && (m.amount !== null || m.debit !== null || m.credit !== null);

const DELIMITER_NAME: Record<string, string> = { ';': 'punto y coma', ',': 'coma', '\t': 'tabulación', '|': 'barra vertical' };

export default function Importar() {
  const allAccounts = useAccounts();
  const accounts = useMemo(() => (allAccounts ?? []).filter((a) => !a.archived), [allAccounts]);
  const categories = useCategories();
  const existing = useTransactions();
  const fileInput = useRef<HTMLInputElement>(null);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [options, setOptions] = useState<Omit<ImportOptions, 'defaultAccountId'>>({ dateFormat: 'auto', decimal: 'auto', expensesArePositive: false, createCategories: true });
  const [accountId, setAccountId] = useState('');
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<(ImportResult & { undone?: number }) | null>(null);

  // por defecto, la cuenta del último movimiento cargado (igual que al cargar uno a mano); si no hay, la primera
  const lastUsed = existing?.[0]?.accountId;
  const defaultAccountId = accountId || accounts.find((a) => a.id === lastUsed)?.id || accounts[0]?.id || '';

  /** Columnas según el encabezado y, lo que no se reconoce, por el contenido. */
  function initialMapping(rows: string[][], header: boolean): ColumnMapping {
    const byHeader = header ? detectMapping(rows[0] ?? []) : EMPTY_MAPPING;
    const guessed = guessMappingFromData(header ? rows.slice(1) : rows);
    const used = new Set(Object.values(byHeader).filter((v): v is number => v !== null));
    const merged = { ...byHeader };
    for (const field of ['date', 'amount', 'description'] as const) {
      const guess = guessed[field];
      // la adivinanza por contenido solo completa lo que el encabezado no resolvió y no pisa columnas ya usadas
      if (merged[field] === null && typeof guess === 'number' && !used.has(guess) && !(field === 'amount' && (byHeader.debit !== null || byHeader.credit !== null))) {
        merged[field] = guess;
        used.add(guess);
      }
    }
    return merged;
  }

  async function handleFile(file: File | undefined) {
    setResult(null);
    setErrors([]);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setLoaded(null);
      return setErrors(['Los archivos de Excel (.xlsx) no se leen directo. Abrilo y guardalo como CSV (Archivo → Guardar como / Descargar → CSV) y elegí ese archivo.']);
    }
    if (file.size > MAX_FILE_BYTES) {
      setLoaded(null);
      return setErrors(['El archivo es demasiado grande (máximo 5 MB).']);
    }
    const { rows, delimiter } = parseCSV(await file.text());
    if (rows.length === 0) {
      setLoaded(null);
      return setErrors(['El archivo está vacío.']);
    }
    const header = looksLikeHeader(rows[0]!);
    if (rows.length - (header ? 1 : 0) > MAX_IMPORT_ROWS) {
      setLoaded(null);
      return setErrors([`El archivo tiene demasiadas filas (máximo ${MAX_IMPORT_ROWS}). Dividilo en varios.`]);
    }
    setLoaded({ name: file.name, rows, delimiter });
    setHasHeader(header);
    const detected = initialMapping(rows, header);
    setMapping(detected);
    setColumnsOpen(!isResolved(detected)); // se muestran solo si la detección no alcanzó
    setIncludeDuplicates(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function toggleHeader(value: boolean) {
    setHasHeader(value);
    if (loaded) {
      const detected = initialMapping(loaded.rows, value);
      setMapping(detected);
      setColumnsOpen(!isResolved(detected));
    }
  }

  const dataRows = useMemo(() => (loaded ? (hasHeader ? loaded.rows.slice(1) : loaded.rows) : []), [loaded, hasHeader]);
  const plan = useMemo(
    () =>
      loaded && existing
        ? buildImportPlan({
            rows: dataRows,
            firstLine: hasHeader ? 2 : 1,
            mapping,
            options: { ...options, defaultAccountId },
            accounts,
            categories,
            existing,
          })
        : null,
    [loaded, existing, dataRows, hasHeader, mapping, options, defaultAccountId, categories, accounts],
  );

  const toImport = plan ? plan.counts.ok + (includeDuplicates ? plan.counts.duplicate : 0) : 0;
  const headers = loaded ? (hasHeader ? loaded.rows[0]! : loaded.rows[0]!.map((_, i) => `Columna ${i + 1}`)) : [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  async function handleImport() {
    if (!plan) return;
    setSaving(true);
    setErrors([]);
    try {
      setResult(await importMovements(db, plan, { includeDuplicates }));
      setLoaded(null);
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo importar. No se guardó nada.']);
    } finally {
      setSaving(false);
    }
  }

  async function handleUndo() {
    if (!result || !window.confirm('¿Deshacer la importación? Se borran los movimientos que se importaron.')) return;
    const undone = await undoImport(db, result.importId, result.createdCategoryIds);
    setResult({ ...result, undone });
  }

  const columnSelect = (field: ImportField, label: string) => (
    <select
      aria-label={label}
      className={inputClass}
      value={mapping[field] ?? ''}
      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === '' ? null : Number(e.target.value) })}
    >
      <option value="">— No tiene —</option>
      {headers.map((h, i) => (
        <option key={i} value={i}>{i + 1}. {h || '(sin nombre)'}</option>
      ))}
    </select>
  );

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Importar movimientos</h1>
      </div>

      {accounts.length === 0 && (
        <p className="rounded-xl bg-amber-950/50 p-3 text-sm text-amber-200">
          Para importar primero creá una cuenta en <Link to="/mas/cuentas" className="underline">Más → Cuentas</Link>.
        </p>
      )}

      {result ? (
        <section className="space-y-3 rounded-xl bg-slate-900 p-4">
          {result.undone === undefined ? (
            <>
              <h2 className="text-lg font-semibold">Listo: se importaron {result.imported} {result.imported === 1 ? 'movimiento' : 'movimientos'}</h2>
              {result.createdCategoryIds.length > 0 && <p className="text-sm text-slate-400">Se crearon {result.createdCategoryIds.length} {result.createdCategoryIds.length === 1 ? 'categoría' : 'categorías'}.</p>}
              <p className="text-sm text-slate-400">Si algo no salió como esperabas, podés deshacer la importación ahora.</p>
              <Link to="/movimientos" className="block rounded-xl bg-brand py-3.5 text-center text-base font-semibold text-white">Ver movimientos</Link>
              <SecondaryButton type="button" onClick={() => void handleUndo()} className="border-red-900 text-red-300">Deshacer importación</SecondaryButton>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold">Importación deshecha</h2>
              <p className="text-sm text-slate-400">Se borraron {result.undone} {result.undone === 1 ? 'movimiento' : 'movimientos'}.</p>
            </>
          )}
          <SecondaryButton type="button" onClick={() => setResult(null)}>Importar otro archivo</SecondaryButton>
        </section>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-400">
            Cargá de una vez una lista de gastos e ingresos desde un archivo CSV (por ejemplo, el de tu banco o una planilla tuya).
            Antes de guardar vas a ver una vista previa.
          </p>

          <section className="space-y-3 rounded-xl bg-slate-900 p-4">
            <h2 className="font-medium">1. Elegí el archivo</h2>
            <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="Elegir archivo CSV" disabled={accounts.length === 0}
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-800 file:px-4 file:py-3 file:text-sm file:font-medium file:text-slate-100" />
            <p className="text-xs text-slate-500">
              ¿Tenés un Excel? Guardalo como CSV (Archivo → Guardar como / Descargar → CSV). Las transferencias y las cuotas de tarjeta no se importan.
            </p>
            <button type="button" onClick={() => downloadFile('plantilla-movimientos.csv', 'text/csv', importTemplateCSV())} className="text-sm text-emerald-400">
              Descargar una plantilla de ejemplo
            </button>
          </section>
        </>
      )}

      <div className="mt-3"><ErrorList errors={errors} /></div>

      {loaded && !result && (
        <div className="mt-3 space-y-3">
          <details open={columnsOpen} onToggle={(e) => setColumnsOpen(e.currentTarget.open)} className="rounded-xl bg-slate-900 p-4">
            <summary className="cursor-pointer">
              <span className="font-medium">2. Columnas</span>
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {loaded.name} · {dataRows.length} {dataRows.length === 1 ? 'fila' : 'filas'} · separado por {DELIMITER_NAME[loaded.delimiter] ?? 'comas'}
              </span>
              <span className={`mt-1 block text-xs font-normal ${isResolved(mapping) ? 'text-emerald-400' : 'text-amber-300'}`}>
                {isResolved(mapping) ? `✓ ${recap(mapping, headers)}` : 'Falta indicar la fecha y el monto'} · {columnsOpen ? 'tocá para cerrar' : 'tocá para revisar'}
              </span>
            </summary>
            <div className="mt-4 space-y-4">
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={hasHeader} onChange={(e) => toggleHeader(e.target.checked)} />
                La primera fila son los títulos de las columnas
              </label>

              {FIELDS.map(({ field, label, optional, hint }) => (
                <Field key={field} label={`${label}${optional ? '' : ' *'}`}>
                  {columnSelect(field, label)}
                  {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
                </Field>
              ))}
            </div>
          </details>

          <section className="space-y-4 rounded-xl bg-slate-900 p-4">
            <h2 className="font-medium">3. Opciones</h2>
            <Field label="Cuenta a la que se importa">
              <select className={inputClass} value={defaultAccountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Formato de fecha">
                <select className={inputClass} value={options.dateFormat} onChange={(e) => setOptions({ ...options, dateFormat: e.target.value as DateFormat })}>
                  <option value="auto">Automático</option>
                  <option value="dmy">Día/mes/año</option>
                  <option value="mdy">Mes/día/año</option>
                  <option value="ymd">Año-mes-día</option>
                </select>
              </Field>
              <Field label="Decimales con">
                <select className={inputClass} value={options.decimal} onChange={(e) => setOptions({ ...options, decimal: e.target.value as DecimalMark })}>
                  <option value="auto">Automático</option>
                  <option value="comma">Coma (1.234,56)</option>
                  <option value="dot">Punto (1,234.56)</option>
                </select>
              </Field>
            </div>
            {mapping.type === null && mapping.amount !== null && (
              <label className="flex items-center gap-3 text-sm text-slate-300">
                <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={options.expensesArePositive} onChange={(e) => setOptions({ ...options, expensesArePositive: e.target.checked })} />
                En este archivo los gastos vienen en positivo
              </label>
            )}
            <label className="flex items-center gap-3 text-sm text-slate-300">
              <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={options.createCategories} onChange={(e) => setOptions({ ...options, createCategories: e.target.checked })} />
              Crear las categorías que no existan
            </label>
          </section>

          {plan && (
            <section className="space-y-3 rounded-xl bg-slate-900 p-4" aria-label="Vista previa">
              <h2 className="font-medium">4. Vista previa</h2>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="rounded-lg bg-slate-800 p-2"><strong className="tabular-nums">{plan.counts.ok}</strong> para importar<span className="block text-xs text-slate-500">{plan.counts.expense} gastos · {plan.counts.income} ingresos</span></li>
                <li className="rounded-lg bg-slate-800 p-2"><strong className="tabular-nums">{plan.counts.duplicate}</strong> {plural(plan.counts.duplicate, 'ya existe', 'ya existen')}<span className="block text-xs text-slate-500">se saltean</span></li>
                <li className="rounded-lg bg-slate-800 p-2"><strong className={`tabular-nums ${plan.counts.error ? 'text-red-400' : ''}`}>{plan.counts.error}</strong> {plural(plan.counts.error, 'con error', 'con errores')}<span className="block text-xs text-slate-500">no se importan</span></li>
                <li className="rounded-lg bg-slate-800 p-2"><strong className="tabular-nums">{plan.counts.skipped}</strong> {plural(plan.counts.skipped, 'salteada', 'salteadas')}<span className="block text-xs text-slate-500">transferencias y cuotas</span></li>
              </ul>

              {(plan.totals.ARS.expense + plan.totals.ARS.income > 0 || plan.totals.USD.expense + plan.totals.USD.income > 0) && (
                <p className="text-sm text-slate-300">
                  {(['ARS', 'USD'] as const).filter((c) => plan.totals[c].expense + plan.totals[c].income > 0).map((c) => (
                    <span key={c} className="block tabular-nums">
                      Gastos {formatMoney(plan.totals[c].expense, c)} · Ingresos {formatMoney(plan.totals[c].income, c)}
                    </span>
                  ))}
                </p>
              )}

              {plan.warnings.map((w) => <p key={w} role="status" className="rounded-lg bg-amber-950/50 p-2 text-xs text-amber-200">{w}</p>)}
              {plan.newCategories.length > 0 && (
                <p className="text-xs text-slate-400">
                  Se van a crear {plan.newCategories.length} {plan.newCategories.length === 1 ? 'categoría' : 'categorías'}:{' '}
                  {plan.newCategories.slice(0, 6).map((c) => c.name).join(', ')}{plan.newCategories.length > 6 ? '…' : ''}.
                </p>
              )}

              <PreviewList title="Primeros movimientos" items={plan.items.filter((i) => i.status === 'ok').slice(0, 6)} categoryName={categoryName} newCategoryName={new Map(plan.newCategories.map((c) => [c.key, c.name]))} accountName={accountName} accounts={accounts.length} />
              <ProblemList items={plan.items.filter((i) => i.status === 'error' || i.status === 'skipped')} />

              {plan.counts.duplicate > 0 && (
                <label className="flex items-center gap-3 text-sm text-slate-300">
                  <input type="checkbox" className="h-5 w-5 accent-emerald-500" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />
                  {plan.counts.duplicate === 1 ? 'Importar también el que ya existe' : `Importar también los ${plan.counts.duplicate} que ya existen`}
                </label>
              )}

              <p className="text-xs text-slate-500">Esto <strong>suma</strong> movimientos: no borra ni cambia los que ya tenés. Si querés estar tranquilo, exportá antes un <Link to="/mas/backup" className="underline">backup</Link>.</p>
              <PrimaryButton type="button" disabled={saving || toImport === 0} onClick={() => void handleImport()}>
                {toImport === 0 ? 'No hay movimientos para importar' : `Importar ${toImport} ${toImport === 1 ? 'movimiento' : 'movimientos'}`}
              </PrimaryButton>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/** "Fecha: Fecha · Monto: Importe · …" con lo que se detectó, para confirmar de un vistazo. */
function recap(m: ColumnMapping, headers: string[]): string {
  const name = (i: number | null) => (i === null ? null : headers[i] || `columna ${i + 1}`);
  return [
    ['Fecha', m.date], ['Monto', m.amount], ['Débito', m.debit], ['Crédito', m.credit], ['Descripción', m.description], ['Categoría', m.category], ['Tipo', m.type], ['Cuenta', m.account],
  ]
    .filter(([, i]) => i !== null)
    .map(([label, i]) => `${label}: ${name(i as number)}`)
    .join(' · ');
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function PreviewList({ title, items, categoryName, newCategoryName, accountName, accounts }: {
  title: string; items: PlanItem[]; categoryName: Map<string, string>; newCategoryName: Map<string, string>; accountName: Map<string, string>; accounts: number;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg bg-slate-800/50">
        {items.map((item) => {
          const d = item.draft!;
          const category = d.category ? ('id' in d.category ? categoryName.get(d.category.id) : `${newCategoryName.get(d.category.newKey) ?? ''} (nueva)`) : undefined;
          return (
            <li key={item.line} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.description || '(sin descripción)'}</span>
                <span className="block truncate text-xs text-slate-500">{formatDate(d.date)}{category ? ` · ${category}` : ''}{accounts > 1 ? ` · ${accountName.get(d.accountId) ?? ''}` : ''}</span>
              </span>
              <span className={`shrink-0 font-medium tabular-nums ${d.type === 'income' ? 'text-emerald-400' : ''}`}>
                {d.type === 'income' ? '+' : '-'}{formatMoney(d.amount)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProblemList({ items }: { items: PlanItem[] }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 8);
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Filas que no se importan ({items.length})</h3>
      <ul className="divide-y divide-slate-800 overflow-hidden rounded-lg bg-slate-800/50 text-sm">
        {shown.map((item) => (
          <li key={item.line} className="flex gap-3 px-3 py-2">
            <span className="shrink-0 text-xs tabular-nums text-slate-500">Línea {item.line}</span>
            <span className={item.status === 'error' ? 'text-red-300' : 'text-slate-400'}>
              <span aria-hidden>{item.status === 'error' ? '⚠ ' : '↷ '}</span>{item.reason}
            </span>
          </li>
        ))}
      </ul>
      {items.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs text-emerald-400">{all ? 'Ver menos' : `Ver las ${items.length}`}</button>
      )}
    </div>
  );
}
