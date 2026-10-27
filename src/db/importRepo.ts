// Guarda un plan de importación (ver domain/importMovements) y permite deshacerlo.
import { validateTransaction } from '../domain/accounts';
import type { CategoryRef, ImportPlan } from '../domain/importMovements';
import type { Category, Transaction } from '../domain/types';
import { deleteCategory } from './catalogRepo';
import { ValidationError } from './errors';
import type { FinanzasDB } from './schema';

/** Tope para no trabar el dispositivo con un archivo enorme. */
export const MAX_IMPORT_ROWS = 20_000;

export interface ImportResult {
  importId: string;
  imported: number;
  createdCategoryIds: string[];
}

/**
 * Importa los movimientos "ok" del plan (y los duplicados, si se pide). Todo o nada: crea las categorías nuevas y
 * los movimientos en una sola transacción, y si algo no valida no queda nada a medias.
 */
export async function importMovements(
  database: FinanzasDB,
  plan: ImportPlan,
  options: { includeDuplicates?: boolean } = {},
): Promise<ImportResult> {
  const chosen = plan.items.filter((i) => i.draft && (i.status === 'ok' || (options.includeDuplicates && i.status === 'duplicate')));
  if (chosen.length === 0) throw new ValidationError(['No hay movimientos para importar.']);
  if (chosen.length > MAX_IMPORT_ROWS) throw new ValidationError([`El archivo tiene demasiados movimientos (máximo ${MAX_IMPORT_ROWS}).`]);

  return database.transaction('rw', database.accounts, database.categories, database.transactions, async () => {
    const accounts = await database.accounts.toArray();
    // ids de categorías que existen: las de la base y, a medida que se crean, las nuevas
    const known = new Set((await database.categories.toArray()).map((c) => c.id));

    // categorías nuevas: se crean primero, resolviendo padres (existentes o del mismo plan)
    const createdIds = new Map<string, string>();
    const byKey = new Map(plan.newCategories.map((c) => [c.key, c]));
    const toCreate: Category[] = [];
    const idFor = (key: string): string => {
      const already = createdIds.get(key);
      if (already) return already;
      const planned = byKey.get(key);
      if (!planned) throw new ValidationError(['El plan de importación está incompleto. Volvé a cargar el archivo.']);
      const parentId = planned.parent ? ('id' in planned.parent ? planned.parent.id : idFor(planned.parent.newKey)) : undefined;
      const category: Category = { id: crypto.randomUUID(), name: planned.name, kind: planned.kind };
      // un padre borrado desde que se armó el plan: la categoría queda como principal
      if (parentId && known.has(parentId)) category.parentId = parentId;
      createdIds.set(key, category.id);
      known.add(category.id);
      toCreate.push(category);
      return category.id;
    };
    // solo se crean las categorías que alguna fila elegida usa (las de duplicados salteados no)
    for (const item of chosen) {
      const ref = item.draft?.category;
      if (ref && 'newKey' in ref) idFor(ref.newKey);
    }

    const categoryId = (ref: CategoryRef | undefined): string | undefined => {
      if (!ref) return undefined;
      const id = 'id' in ref ? ref.id : createdIds.get(ref.newKey);
      return id && known.has(id) ? id : undefined; // una categoría borrada desde que se armó el plan → sin categoría
    };

    const importId = crypto.randomUUID();
    const transactions: Transaction[] = chosen.map((item) => {
      const d = item.draft!;
      const tx: Transaction = {
        id: crypto.randomUUID(),
        type: d.type,
        accountId: d.accountId,
        amount: d.amount,
        date: d.date,
        description: d.description,
        importId,
      };
      const category = categoryId(d.category);
      if (category) tx.categoryId = category;
      const errors = validateTransaction(tx, accounts);
      if (errors.length) throw new ValidationError([`Línea ${item.line}: ${errors.join(' ')}`]);
      return tx;
    });

    await database.categories.bulkAdd(toCreate);
    await database.transactions.bulkAdd(transactions);
    return { importId, imported: transactions.length, createdCategoryIds: toCreate.map((c) => c.id) };
  });
}

/** Deshace una importación: borra sus movimientos y las categorías que creó si quedaron sin uso. */
export async function undoImport(database: FinanzasDB, importId: string, createdCategoryIds: readonly string[] = []): Promise<number> {
  const removed = await database.transactions.filter((t) => t.importId === importId).delete();
  // primero las subcategorías, después sus padres
  for (const id of [...createdCategoryIds].reverse()) {
    try {
      await deleteCategory(database, id);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error; // la categoría ya se usa en otro lado: se conserva
    }
  }
  return removed;
}
