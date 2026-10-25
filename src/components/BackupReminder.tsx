import { Link } from 'react-router-dom';
import { backupReminder } from '../domain/backup';
import { today } from '../domain/dates';
import { useAccounts, useSettings, useTransactions } from '../hooks/useData';

/** Aviso si pasaron más de 15 días desde el último backup. No aparece mientras no haya datos. */
export default function BackupReminder() {
  const settings = useSettings();
  const accounts = useAccounts();
  const transactions = useTransactions();
  if (settings === undefined || !accounts || !transactions) return null;

  const { due, days, neverExported } = backupReminder(settings, today(), accounts.length > 0 || transactions.length > 0);
  if (!due || days === null) return null;
  return (
    <p role="status" className="mb-3 rounded-xl bg-amber-950/60 p-3 text-sm text-amber-200">
      {neverExported ? `Todavía no hiciste ningún backup y usás la app hace ${days} días.` : `Hace ${days} días que no hacés un backup.`}{' '}
      Tus datos viven solo en este dispositivo.{' '}
      <Link to="/mas/backup" className="font-medium underline">Exportar ahora</Link>
    </p>
  );
}
