// Presupuestos, categorías y ajustes: escrituras con sus validaciones.
import { isValidDate } from '../domain/dates';
import type { Budget, Category } from '../domain/types';
import { ValidationError } from './errors';
import { SETTINGS_ID, type FinanzasDB } from './schema';
import { CARD_PAYMENT_CATEGORY_ID } from './seed';

// ---------- Presupuestos ----------

/** `month` es 'YYYY-MM' o 'default' (se repite todos los meses). Un solo presupuesto por categoría y mes. */
export async function saveBudget(database: FinanzasDB, categoryId: string, month: string, amount: number): Promise<void> {
  if (month !== 'default' && !isValidDate(`${month}-01`)) throw new ValidationError(['El mes no es válido.']);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError(['El presupuesto tiene que ser mayor a cero.']);
  await database.transaction('rw', database.budgets, database.categories, async () => {
    const category = await database.categories.get(categoryId);
    if (!category || category.kind !== 'expense') throw new ValidationError(['El presupuesto va sobre una categoría de gastos.']);
    const existing = await database.budgets.where('[categoryId+month]').equals([categoryId, month]).first();
    const budget: Budget = { id: existing?.id ?? crypto.randomUUID(), categoryId, month, amount };
    await database.budgets.put(budget);
  });
}

export async function deleteBudget(database: FinanzasDB, categoryId: string, month: string): Promise<void> {
  await database.budgets.where('[categoryId+month]').equals([categoryId, month]).delete();
}

// ---------- Categorías ----------

export type CategoryDraft = Omit<Category, 'id'> & { id?: string };

export async function saveCategory(database: FinanzasDB, draft: CategoryDraft): Promise<string> {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (!name) errors.push('Poné un nombre.');
  if (draft.id === CARD_PAYMENT_CATEGORY_ID) errors.push('La categoría "Pago de tarjeta" es del sistema y no se edita.');
  if (errors.length) throw new ValidationError(errors);

  return database.transaction('rw', database.categories, database.transactions, database.installments, database.cardPurchases, async () => {
    const all = await database.categories.toArray();
    const byId = new Map(all.map((c) => [c.id, c]));

    if (draft.parentId) {
      const parent = byId.get(draft.parentId);
      if (!parent) throw new ValidationError(['La categoría padre no existe.']);
      if (parent.kind !== draft.kind) throw new ValidationError(['La subcategoría tiene que ser del mismo tipo que su padre.']);
      if (draft.id) {
        // no se puede colgar una categoría de sí misma ni de sus descendientes
        for (let cursor: Category | undefined = parent; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
          if (cursor.id === draft.id) throw new ValidationError(['Una categoría no puede ser subcategoría de sí misma o de sus subcategorías.']);
        }
      }
    }
    if (draft.id) {
      const previous = byId.get(draft.id);
      if (previous && previous.kind !== draft.kind) {
        const used =
          (await database.transactions.where('categoryId').equals(draft.id).count()) +
          (await database.installments.filter((i) => i.categoryId === draft.id).count()) +
          (await database.cardPurchases.filter((p) => p.categoryId === draft.id).count());
        if (used > 0) throw new ValidationError(['No se puede cambiar de gasto a ingreso (o al revés) una categoría que ya tiene movimientos.']);
        if (all.some((c) => c.parentId === draft.id)) throw new ValidationError(['Primero pasá sus subcategorías a otra categoría.']);
      }
    }
    const duplicated = all.some(
      (c) => c.id !== draft.id && c.kind === draft.kind && (c.parentId ?? '') === (draft.parentId ?? '') && c.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicated) throw new ValidationError(['Ya existe una categoría con ese nombre en el mismo nivel.']);

    const category: Category = { ...draft, name, id: draft.id ?? crypto.randomUUID() };
    if (!category.parentId) delete category.parentId;
    await database.categories.put(category);
    return category.id;
  });
}

/** Solo se borran categorías sin uso; si tiene movimientos, cuotas, presupuestos o subcategorías, se avisa. */
export async function deleteCategory(database: FinanzasDB, categoryId: string): Promise<void> {
  if (categoryId === CARD_PAYMENT_CATEGORY_ID) throw new ValidationError(['La categoría "Pago de tarjeta" es del sistema y no se borra.']);
  await database.transaction(
    'rw',
    [database.categories, database.transactions, database.installments, database.cardPurchases, database.budgets, database.recurrings],
    async () => {
      const reasons: string[] = [];
      if ((await database.categories.where('parentId').equals(categoryId).count()) > 0) reasons.push('tiene subcategorías');
      const moves =
        (await database.transactions.where('categoryId').equals(categoryId).count()) +
        (await database.installments.filter((i) => i.categoryId === categoryId).count()) +
        (await database.cardPurchases.filter((p) => p.categoryId === categoryId).count());
      if (moves > 0) reasons.push('tiene movimientos');
      if ((await database.budgets.where('categoryId').equals(categoryId).count()) > 0) reasons.push('tiene presupuestos');
      if (reasons.length) throw new ValidationError([`No se puede borrar: ${reasons.join(' y ')}.`]);
      await database.categories.delete(categoryId);
    },
  );
}

// ---------- Ajustes ----------

/** Cotización de referencia (pesos por dólar) para los totales consolidados. Vacía la quita. */
export async function saveUsdRate(database: FinanzasDB, rate: number | undefined): Promise<void> {
  if (rate !== undefined && !(Number.isFinite(rate) && rate > 0)) throw new ValidationError(['La cotización tiene que ser mayor a cero.']);
  await database.transaction('rw', database.settings, async () => {
    const current = (await database.settings.get(SETTINGS_ID)) ?? { id: SETTINGS_ID, firstDayOfWeek: 1 as const };
    const next = { ...current };
    if (rate === undefined) delete next.usdRate;
    else next.usdRate = rate;
    await database.settings.put(next);
  });
}

/** Preferencia de apariencia. */
export async function saveTheme(database: FinanzasDB, theme: 'system' | 'light' | 'dark'): Promise<void> {
  if (!['system', 'light', 'dark'].includes(theme)) throw new ValidationError(['La apariencia no es válida.']);
  await database.transaction('rw', database.settings, async () => {
    const current = (await database.settings.get(SETTINGS_ID)) ?? { id: SETTINGS_ID, firstDayOfWeek: 1 as const };
    await database.settings.put({ ...current, theme });
  });
}
