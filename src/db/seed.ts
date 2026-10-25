// Datos iniciales: categorías típicas (SPEC §5.6) y settings por defecto.
import { today } from '../domain/dates';
import type { Category } from '../domain/types';
import { SETTINGS_ID, type FinanzasDB } from './schema';

/**
 * Categoría especial para los pagos de resumen. Tiene id fijo para poder excluirla
 * de los reportes de gastos (el gasto ya se contó en cada cuota, SPEC §4.8).
 */
export const CARD_PAYMENT_CATEGORY_ID = 'card-payment';

type SeedCategory = Pick<Category, 'name' | 'kind' | 'icon' | 'color'>;

const EXPENSE_CATEGORIES: SeedCategory[] = [
  { name: 'Supermercado', kind: 'expense', icon: '🛒', color: '#22c55e' },
  { name: 'Restaurantes', kind: 'expense', icon: '🍽️', color: '#f97316' },
  { name: 'Transporte', kind: 'expense', icon: '🚌', color: '#0ea5e9' },
  { name: 'Combustible', kind: 'expense', icon: '⛽', color: '#eab308' },
  { name: 'Servicios', kind: 'expense', icon: '💡', color: '#facc15' },
  { name: 'Alquiler', kind: 'expense', icon: '🏠', color: '#a855f7' },
  { name: 'Salud', kind: 'expense', icon: '🩺', color: '#ef4444' },
  { name: 'Educación', kind: 'expense', icon: '🎓', color: '#6366f1' },
  { name: 'Ropa', kind: 'expense', icon: '👕', color: '#ec4899' },
  { name: 'Tecnología', kind: 'expense', icon: '💻', color: '#14b8a6' },
  { name: 'Entretenimiento', kind: 'expense', icon: '🎬', color: '#f43f5e' },
  { name: 'Suscripciones', kind: 'expense', icon: '🔁', color: '#8b5cf6' },
  { name: 'Regalos', kind: 'expense', icon: '🎁', color: '#d946ef' },
  { name: 'Viajes', kind: 'expense', icon: '✈️', color: '#06b6d4' },
  { name: 'Otros', kind: 'expense', icon: '📦', color: '#64748b' },
];

const INCOME_CATEGORIES: SeedCategory[] = [
  { name: 'Sueldo', kind: 'income', icon: '💼', color: '#10b981' },
  { name: 'Freelance', kind: 'income', icon: '🧑‍💻', color: '#3b82f6' },
  { name: 'Inversiones', kind: 'income', icon: '📈', color: '#84cc16' },
  { name: 'Otros', kind: 'income', icon: '💰', color: '#64748b' },
];

/** Carga categorías y settings solo si la base está vacía. Es idempotente. */
export async function seedIfEmpty(database: FinanzasDB): Promise<void> {
  await database.transaction('rw', database.categories, database.settings, async () => {
    if ((await database.categories.count()) === 0) {
      const categories: Category[] = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map((c) => ({
        ...c,
        id: crypto.randomUUID(),
      }));
      categories.push({
        id: CARD_PAYMENT_CATEGORY_ID,
        name: 'Pago de tarjeta',
        kind: 'expense',
        icon: '💳',
        color: '#475569',
      });
      await database.categories.bulkAdd(categories);
    }
    const settings = await database.settings.get(SETTINGS_ID);
    if (!settings) {
      await database.settings.add({ id: SETTINGS_ID, firstDayOfWeek: 1, installedAt: today() });
    } else if (!settings.installedAt) {
      // bases creadas antes de existir el recordatorio de backup: se cuenta desde ahora
      await database.settings.put({ ...settings, installedAt: today() });
    }
  });
}
