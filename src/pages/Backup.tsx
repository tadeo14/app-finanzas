import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BackupReminder from '../components/BackupReminder';
import { DangerButton, ErrorList, PrimaryButton, SecondaryButton } from '../components/ui';
import { backupReminder, countRows, type BackupFile, type BackupTable } from '../domain/backup';
import { formatDate, today } from '../domain/dates';
import { backupFileName, exportBackup, exportMovementsCSV, importBackup, parseBackup } from '../db/backup';
import { ValidationError } from '../db/errors';
import { downloadFile, readFileText } from '../db/files';
import { db } from '../db/schema';
import { useAccounts, useSettings, useTransactions } from '../hooks/useData';

const LABELS: [BackupTable, string, string][] = [
  ['accounts', 'cuenta', 'cuentas'],
  ['transactions', 'movimiento', 'movimientos'],
  ['cards', 'tarjeta', 'tarjetas'],
  ['cardPurchases', 'compra con tarjeta', 'compras con tarjeta'],
  ['statementPayments', 'pago de resumen', 'pagos de resumen'],
  ['categories', 'categoría', 'categorías'],
  ['budgets', 'presupuesto', 'presupuestos'],
  ['recurrings', 'recurrente', 'recurrentes'],
];

export default function Backup() {
  const settings = useSettings();
  const accounts = useAccounts();
  const transactions = useTransactions();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();

  const now = today();
  const status = backupReminder(settings, now, (accounts?.length ?? 0) > 0 || (transactions?.length ?? 0) > 0);

  async function handleExport() {
    setErrors([]);
    const backup = await exportBackup(db);
    downloadFile(backupFileName(), 'application/json', JSON.stringify(backup));
    setNotice('Backup exportado. Guardalo en un lugar seguro (por ejemplo, tu nube o tu correo).');
  }

  async function handleCsv() {
    setErrors([]);
    downloadFile(`finanzas-movimientos-${now}.csv`, 'text/csv', await exportMovementsCSV(db));
    setNotice('Movimientos exportados a CSV.');
  }

  async function handleFile(file: File | undefined) {
    setNotice(undefined);
    setPending(null);
    if (!file) return;
    const result = parseBackup(await readFileText(file));
    if (result.ok) {
      setErrors([]);
      setPending(result.backup);
    } else {
      setErrors(result.errors);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleReplace() {
    if (!pending) return;
    if (!window.confirm('Se van a borrar todos los datos actuales de este dispositivo y reemplazar por los del archivo. ¿Continuar?')) return;
    try {
      await importBackup(db, pending);
      setPending(null);
      setErrors([]);
      setNotice('Backup importado. Tus datos ahora son los del archivo.');
    } catch (error) {
      setErrors(error instanceof ValidationError ? error.errors : ['No se pudo importar el backup. Tus datos actuales no se tocaron.']);
    }
  }

  const counts = pending ? countRows(pending) : null;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link to="/mas" aria-label="Volver" className="py-1 pr-2 text-xl text-slate-400">‹</Link>
        <h1 className="text-2xl font-semibold">Backup</h1>
      </div>
      <BackupReminder />

      <section className="rounded-xl bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Último backup</p>
        <p className="mt-1 text-lg font-medium">
          {settings?.lastBackupAt ? `${formatDate(settings.lastBackupAt)}${status.days === null ? '' : status.days === 0 ? ' (hoy)' : ` (hace ${status.days} ${status.days === 1 ? 'día' : 'días'})`}` : 'Nunca'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Tus datos están solo en este dispositivo. Si borrás los datos del navegador o perdés el celular, un backup es la única forma de recuperarlos.
        </p>
      </section>

      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-950/60 p-3 text-sm text-emerald-200">{notice}</p>}
      <div className="mt-3">
        <ErrorList errors={errors} />
      </div>

      <div className="mt-4 space-y-3">
        <PrimaryButton type="button" onClick={() => void handleExport()}>Exportar backup (JSON)</PrimaryButton>
        <SecondaryButton type="button" onClick={() => void handleCsv()}>Exportar movimientos (CSV)</SecondaryButton>
        <p className="text-xs text-slate-500">
          El CSV es para abrirlo en una planilla; no sirve para restaurar. En iPhone el archivo se abre en una pestaña: usá Compartir → Guardar en Archivos.
        </p>
      </div>

      <h2 className="mb-2 mt-8 text-xs font-medium uppercase tracking-wide text-slate-500">Importar</h2>
      <input ref={fileInput} type="file" accept="application/json,.json" aria-label="Elegir archivo de backup" onChange={(e) => void handleFile(e.target.files?.[0])}
        className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-800 file:px-4 file:py-3 file:text-sm file:font-medium file:text-slate-100" />

      {pending && counts && (
        <section className="mt-4 space-y-3 rounded-xl border border-red-900/60 bg-slate-900 p-4">
          <h3 className="font-medium">Este backup tiene</h3>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-300">
            {LABELS.filter(([table]) => counts[table] > 0).map(([table, one, many]) => (
              <li key={table}>{counts[table]} {counts[table] === 1 ? one : many}</li>
            ))}
          </ul>
          {pending.exportedAt && <p className="text-xs text-slate-500">Exportado el {formatDate(pending.exportedAt.slice(0, 10))}.</p>}
          <p className="rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
            Al continuar se <strong>reemplazan todos los datos actuales</strong> de este dispositivo. Si no estás seguro, exportá primero un backup de lo que tenés ahora.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton type="button" onClick={() => setPending(null)}>Cancelar</SecondaryButton>
            <DangerButton type="button" onClick={() => void handleReplace()}>Reemplazar todo</DangerButton>
          </div>
        </section>
      )}
    </>
  );
}
