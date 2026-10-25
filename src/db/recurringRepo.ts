// Recurrentes: alta, baja y generación de las ocurrencias pendientes al abrir la app.
import { occurrencesDue, purchaseFor, transactionFor, validateRecurring } from '../domain/recurring';
import { today } from '../domain/dates';
import type { Recurring } from '../domain/types';
import { savePurchase } from './cardsRepo';
import { ValidationError } from './errors';
import { saveTransaction } from './repo';
import type { FinanzasDB } from './schema';

export type RecurringDraft = Omit<Recurring, 'id'> & { id?: string };

export async function saveRecurring(database: FinanzasDB, draft: RecurringDraft): Promise<string> {
  const errors = validateRecurring(draft);
  if (errors.length) throw new ValidationError(errors);
  const recurring: Recurring = { ...draft, id: draft.id ?? crypto.randomUUID() };
  if (recurring.frequency !== 'monthly') delete recurring.dayOfMonth;
  await database.recurrings.put(recurring);
  return recurring.id;
}

/** Borra la regla; lo que ya generó queda como movimientos comunes. */
export async function deleteRecurring(database: FinanzasDB, id: string): Promise<void> {
  await database.recurrings.delete(id);
}

export interface RecurringFailure {
  recurringId: string;
  description: string;
  message: string;
}

/**
 * Genera las ocurrencias que faltan de cada recurrente, hasta hoy. Cada recurrente es todo o nada: si
 * una ocurrencia no se puede crear (por ejemplo la cuenta o la tarjeta ya no existe) no se genera ninguna
 * ni se avanza `lastGenerated`, así se reintenta en la próxima apertura. Es seguro correrlo varias veces.
 */
export async function generateDueRecurrings(
  database: FinanzasDB,
  todayDate: string = today(),
): Promise<{ generated: number; failures: RecurringFailure[] }> {
  const ids = (await database.recurrings.toArray()).map((r) => r.id);
  let generated = 0;
  const failures: RecurringFailure[] = [];

  for (const id of ids) {
    try {
      generated += await database.transaction(
        'rw',
        [database.recurrings, database.accounts, database.transactions, database.cards, database.statements, database.cardPurchases, database.installments],
        async () => {
          // se lee adentro de la transacción: si hay dos pestañas abiertas, la segunda ve el lastGenerated de la primera
          const recurring = await database.recurrings.get(id);
          if (!recurring) return 0;
          const dates = occurrencesDue(recurring, todayDate);
          for (const date of dates) {
            if (recurring.kind === 'transaction') {
              const { id: _id, ...draft } = transactionFor(recurring, date, '');
              await saveTransaction(database, draft);
            } else {
              const { id: _id, ...draft } = purchaseFor(recurring, date, '');
              await savePurchase(database, draft);
            }
          }
          if (dates.length > 0) await database.recurrings.update(id, { lastGenerated: dates[dates.length - 1] });
          return dates.length;
        },
      );
    } catch (error) {
      const recurring = await database.recurrings.get(id);
      const template = recurring?.template as { description?: string } | undefined;
      failures.push({
        recurringId: id,
        description: template?.description || 'Recurrente sin descripción',
        message: error instanceof ValidationError ? error.errors.join(' ') : 'No se pudo generar.',
      });
    }
  }
  return { generated, failures };
}
