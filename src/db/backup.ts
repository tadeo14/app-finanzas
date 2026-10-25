// Export e import del backup completo. Importar reemplaza todo en una sola transacción: si algo falla,
// la base queda como estaba.
import { BACKUP_APP, BACKUP_FORMAT, BACKUP_TABLES, validateBackup, type BackupFile, type BackupTable } from '../domain/backup';
import { movementsToCSV } from '../domain/csv';
import { today } from '../domain/dates';
import { ValidationError } from './errors';
import { SETTINGS_ID, type FinanzasDB } from './schema';

/** Anota que hoy se hizo un backup (es lo que mira el recordatorio). */
export async function markBackup(database: FinanzasDB, todayDate: string = today()): Promise<void> {
  await database.transaction('rw', database.settings, async () => {
    const current = (await database.settings.get(SETTINGS_ID)) ?? { id: SETTINGS_ID, firstDayOfWeek: 1 as const };
    await database.settings.put({ ...current, lastBackupAt: todayDate });
  });
}

/** Todas las tablas leídas en una sola transacción, para que el archivo sea consistente. */
export async function exportBackup(database: FinanzasDB, now: Date = new Date()): Promise<BackupFile> {
  await markBackup(database, today(now));
  const tables = BACKUP_TABLES.map((name) => database.table(name));
  const rows = await database.transaction('r', tables, () => Promise.all(tables.map((t) => t.toArray())));
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    data: Object.fromEntries(BACKUP_TABLES.map((name, i) => [name, rows[i]])) as BackupFile['data'],
  };
}

export function backupFileName(todayDate: string = today()): string {
  return `finanzas-backup-${todayDate}.json`;
}

/** Texto del archivo JSON a validar → resultado. No toca la base. */
export function parseBackup(text: string): ReturnType<typeof validateBackup> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['El archivo no es un JSON válido.'] };
  }
  return validateBackup(raw);
}

/** Reemplaza todos los datos por los del backup (ya validado). Todo o nada. */
export async function importBackup(database: FinanzasDB, backup: BackupFile): Promise<void> {
  const checked = validateBackup(backup);
  if (!checked.ok) throw new ValidationError(checked.errors);

  const tables = BACKUP_TABLES.map((name) => database.table(name));
  await database.transaction('rw', tables, async () => {
    for (const name of BACKUP_TABLES as readonly BackupTable[]) {
      const table = database.table(name);
      await table.clear();
      await table.bulkAdd(backup.data[name]);
    }
    if (!(await database.settings.get(SETTINGS_ID))) {
      await database.settings.add({ id: SETTINGS_ID, firstDayOfWeek: 1, installedAt: today() });
    }
  });
}

/** CSV con todos los movimientos (de cuentas y cuotas de tarjeta). */
export async function exportMovementsCSV(database: FinanzasDB): Promise<string> {
  const [transactions, installments, purchases, cards, statements, accounts, categories] = await Promise.all([
    database.transactions.toArray(),
    database.installments.toArray(),
    database.cardPurchases.toArray(),
    database.cards.toArray(),
    database.statements.toArray(),
    database.accounts.toArray(),
    database.categories.toArray(),
  ]);
  return movementsToCSV({ transactions, installments, purchases, cards, statements, accounts, categories });
}
