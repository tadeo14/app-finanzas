// Escrituras de tarjetas, resúmenes, compras y cuotas. Toda la lógica de cuotas vive en domain/cards.
import {
  advanceInstallments,
  defaultStatementDates,
  generateInstallments,
  normalizePurchase,
  periodForPurchase,
  reassignPurchases,
  validatePurchase,
} from '../domain/cards';
import { isValidDate } from '../domain/dates';
import type { Card, CardPurchase, Statement } from '../domain/types';
import { ValidationError } from './errors';
import type { FinanzasDB } from './schema';

export type CardDraft = Omit<Card, 'id'> & { id?: string };
export type PurchaseDraft = Omit<CardPurchase, 'id'> & { id?: string };

const validDay = (d: number) => Number.isInteger(d) && d >= 1 && d <= 31;

export async function saveCard(database: FinanzasDB, draft: CardDraft): Promise<string> {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Poné un nombre.');
  if (!validDay(draft.defaultClosingDay)) errors.push('El día de cierre tiene que estar entre 1 y 31.');
  if (!validDay(draft.defaultDueDay)) errors.push('El día de vencimiento tiene que estar entre 1 y 31.');
  if (draft.limit !== undefined && (!Number.isSafeInteger(draft.limit) || draft.limit <= 0)) {
    errors.push('El límite tiene que ser mayor a cero.');
  }
  if (errors.length) throw new ValidationError(errors);

  const card: Card = { ...draft, name: draft.name.trim(), id: draft.id ?? crypto.randomUUID() };
  await database.cards.put(card);
  return card.id;
}

/** Solo se borran tarjetas sin compras; las demás se archivan para no perder historia. */
export async function deleteCard(database: FinanzasDB, cardId: string): Promise<void> {
  await database.transaction('rw', database.cards, database.statements, database.cardPurchases, async () => {
    if ((await database.cardPurchases.where('cardId').equals(cardId).count()) > 0) {
      throw new ValidationError(['La tarjeta tiene compras: archivala en vez de borrarla.']);
    }
    await database.statements.where('cardId').equals(cardId).delete();
    await database.cards.delete(cardId);
  });
}

/** Crea el resumen con las fechas por defecto si todavía no existe. */
export async function ensureStatement(database: FinanzasDB, cardId: string, period: string): Promise<Statement> {
  return database.transaction('rw', database.cards, database.statements, async () => {
    const existing = await database.statements.where('[cardId+period]').equals([cardId, period]).first();
    if (existing) return existing;
    const card = await database.cards.get(cardId);
    if (!card) throw new ValidationError(['La tarjeta no existe.']);
    const statement: Statement = { id: crypto.randomUUID(), cardId, period, ...defaultStatementDates(card, period) };
    await database.statements.add(statement);
    return statement;
  });
}

/**
 * Guarda las fechas editadas de un resumen y reubica las compras que, con la nueva fecha de cierre,
 * pasan a caer en otro resumen.
 */
export async function saveStatementDates(
  database: FinanzasDB,
  cardId: string,
  period: string,
  closingDate: string,
  dueDate: string,
): Promise<void> {
  if (!isValidDate(closingDate) || !isValidDate(dueDate)) throw new ValidationError(['Las fechas no son válidas.']);
  if (closingDate > dueDate) throw new ValidationError(['El vencimiento no puede ser anterior al cierre.']);

  await database.transaction('rw', database.cards, database.statements, database.cardPurchases, database.installments, async () => {
    const statement = await ensureStatement(database, cardId, period);
    await database.statements.put({ ...statement, closingDate, dueDate });

    const card = (await database.cards.get(cardId))!;
    const [statements, purchases, installments] = await Promise.all([
      database.statements.where('cardId').equals(cardId).toArray(),
      database.cardPurchases.where('cardId').equals(cardId).toArray(),
      database.installments.where('cardId').equals(cardId).toArray(),
    ]);
    const updates = reassignPurchases(card, statements, purchases, installments);
    const byId = new Map(installments.map((i) => [i.id, i]));
    await database.installments.bulkPut(updates.map((u) => ({ ...byId.get(u.installmentId)!, period: u.period })));
  });
}

/**
 * Guarda la compra y regenera todas sus cuotas (SPEC §4.4: editar = borrar y regenerar, lo que de
 * paso propaga el cambio de categoría a cada cuota).
 */
export async function savePurchase(
  database: FinanzasDB,
  draft: PurchaseDraft,
): Promise<{ id: string; firstPeriod: string }> {
  const errors = validatePurchase(draft);
  if (errors.length) throw new ValidationError(errors);

  return database.transaction('rw', database.cards, database.statements, database.cardPurchases, database.installments, async () => {
    const card = await database.cards.get(draft.cardId);
    if (!card) throw new ValidationError(['Elegí una tarjeta.']);

    const purchase = normalizePurchase({ ...draft, id: draft.id ?? crypto.randomUUID(), description: draft.description.trim() });
    const statements = await database.statements.where('cardId').equals(card.id).toArray();
    const firstPeriod = periodForPurchase(card, statements, purchase.date, purchase.firstPeriodOverride);

    await database.cardPurchases.put(purchase);
    await database.installments.where('purchaseId').equals(purchase.id).delete();
    await database.installments.bulkAdd(generateInstallments(purchase, firstPeriod));
    return { id: purchase.id, firstPeriod };
  });
}

export async function deletePurchase(database: FinanzasDB, purchaseId: string): Promise<void> {
  await database.transaction('rw', database.cardPurchases, database.installments, async () => {
    await database.installments.where('purchaseId').equals(purchaseId).delete();
    await database.cardPurchases.delete(purchaseId);
  });
}

/** Adelanta las cuotas restantes de la compra al resumen `targetPeriod`. */
export async function advancePurchase(database: FinanzasDB, purchaseId: string, targetPeriod: string): Promise<void> {
  await database.transaction('rw', database.installments, async () => {
    const own = await database.installments.where('purchaseId').equals(purchaseId).toArray();
    let result;
    try {
      result = advanceInstallments(own, targetPeriod);
    } catch (error) {
      throw new ValidationError([error instanceof Error ? error.message : 'No se pudo adelantar.']);
    }
    for (const id of result.cancelledIds) await database.installments.update(id, { status: 'cancelled' });
    await database.installments.add(result.merged);
  });
}
