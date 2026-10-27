import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCSV } from '../domain/csvParse';
import { buildImportPlan, detectMapping, looksLikeHeader, type ImportOptions } from '../domain/importMovements';
import { validateBackup } from '../domain/backup';
import { exportBackup, exportMovementsCSV } from './backup';
import { saveCategory } from './catalogRepo';
import { saveCard, savePurchase } from './cardsRepo';
import { importMovements, undoImport } from './importRepo';
import { deleteAccount, saveAccount, saveTransaction } from './repo';
import { FinanzasDB } from './schema';

let database: FinanzasDB;
let pesos: string;
let usd: string;
let comida: string;

const options = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  defaultAccountId: pesos, dateFormat: 'auto', decimal: 'auto', expensesArePositive: false, createCategories: true, ...over,
});

async function planFor(csv: string, over: Partial<ImportOptions> = {}) {
  const { rows } = parseCSV(csv);
  const hasHeader = looksLikeHeader(rows[0]!);
  return buildImportPlan({
    rows: hasHeader ? rows.slice(1) : rows,
    firstLine: hasHeader ? 2 : 1,
    mapping: detectMapping(hasHeader ? rows[0]! : []),
    options: options(over),
    accounts: await database.accounts.toArray(),
    categories: await database.categories.toArray(),
    existing: await database.transactions.toArray(),
  });
}

beforeEach(async () => {
  database = new FinanzasDB(`test-${crypto.randomUUID()}`);
  pesos = await saveAccount(database, { name: 'Galicia', type: 'bank', currency: 'ARS', initialBalance: 100_000, archived: false });
  usd = await saveAccount(database, { name: 'Dólares', type: 'cash', currency: 'USD', initialBalance: 0, archived: false });
  comida = await saveCategory(database, { name: 'Comida', kind: 'expense' });
});

afterEach(async () => {
  await database.delete();
});

const CSV = `Fecha;Descripción;Monto;Categoría
15/10/2026;Coto;-12345,67;Comida
16/10/2026;Sueldo;800000;Sueldo
17/10/2026;Veterinaria;-5000;Mascotas > Veterinaria
18/10/2026;Sin categoría;-5;
`;

describe('importMovements', () => {
  it('guarda los movimientos y las categorías nuevas (con su padre) y el saldo cuadra', async () => {
    const plan = await planFor(CSV);
    expect(plan.counts).toMatchObject({ ok: 4, error: 0 });
    const result = await importMovements(database, plan);
    expect(result.imported).toBe(4);

    const txs = (await database.transactions.toArray()).sort((a, b) => a.date.localeCompare(b.date));
    expect(txs.map((t) => [t.date, t.type, t.amount, t.description])).toEqual([
      ['2026-10-15', 'expense', 1_234_567, 'Coto'],
      ['2026-10-16', 'income', 80_000_000, 'Sueldo'],
      ['2026-10-17', 'expense', 500_000, 'Veterinaria'],
      ['2026-10-18', 'expense', 500, 'Sin categoría'],
    ]);
    expect(txs.every((t) => t.importId === result.importId && t.accountId === pesos)).toBe(true);
    expect(txs[0]!.categoryId).toBe(comida);

    const categories = await database.categories.toArray();
    const mascotas = categories.find((c) => c.name === 'Mascotas');
    const vet = categories.find((c) => c.name === 'Veterinaria');
    expect(mascotas).toMatchObject({ kind: 'expense' });
    expect(mascotas?.parentId).toBeUndefined();
    expect(vet?.parentId).toBe(mascotas?.id);
    expect(txs[2]!.categoryId).toBe(vet?.id);
    expect(categories.find((c) => c.name === 'Sueldo')).toMatchObject({ kind: 'income' });
    expect(new Set(result.createdCategoryIds)).toEqual(new Set([mascotas!.id, vet!.id, categories.find((c) => c.name === 'Sueldo')!.id]));
  });

  it('reimportar el mismo archivo no duplica nada', async () => {
    await importMovements(database, await planFor(CSV));
    const again = await planFor(CSV);
    expect(again.counts).toMatchObject({ ok: 0, duplicate: 4 });
    await expect(importMovements(database, again)).rejects.toThrow('No hay movimientos para importar');
    expect(await database.transactions.count()).toBe(4);
  });

  it('se pueden incluir los duplicados si el usuario lo pide', async () => {
    await importMovements(database, await planFor(CSV));
    const result = await importMovements(database, await planFor(CSV), { includeDuplicates: true });
    expect(result.imported).toBe(4);
    expect(await database.transactions.count()).toBe(8);
  });

  it('no crea categorías que solo usan filas duplicadas que se saltean', async () => {
    await importMovements(database, await planFor('Fecha;Monto;Categoría\n15/10/2026;-5;Gimnasio'));
    const before = (await database.categories.toArray()).length;
    await importMovements(database, await planFor('Fecha;Monto;Categoría\n15/10/2026;-5;Gimnasio\n16/10/2026;-7;Gimnasio'));
    expect((await database.categories.toArray()).length).toBe(before);
  });

  it('todo o nada: si algo no valida no queda nada a medias, ni categorías', async () => {
    const plan = await planFor('Fecha;Monto;Categoría\n15/10/2026;-5;Nueva\n16/10/2026;-7;Nueva');
    await deleteAccount(database, pesos); // la cuenta desaparece entre la vista previa y el guardado
    await expect(importMovements(database, plan)).rejects.toThrow('Línea 2');
    expect(await database.transactions.count()).toBe(0);
    expect((await database.categories.toArray()).some((c) => c.name === 'Nueva')).toBe(false);
  });

  it('una categoría borrada desde la vista previa deja la fila sin categoría en vez de romper', async () => {
    const libre = await saveCategory(database, { name: 'Libre', kind: 'expense' });
    const plan = await planFor('Fecha;Monto;Categoría\n15/10/2026;-5;Libre', { createCategories: false });
    expect(plan.items[0]!.draft?.category).toEqual({ id: libre });
    await database.categories.delete(libre);
    await importMovements(database, plan);
    expect((await database.transactions.toArray())[0]!.categoryId).toBeUndefined();
  });

  it('rechaza un plan sin nada para importar o demasiado grande', async () => {
    await expect(importMovements(database, await planFor('Fecha;Monto\nxx;yy'))).rejects.toThrow('No hay movimientos');
  });

  it('el backup con movimientos importados sigue siendo válido', async () => {
    await importMovements(database, await planFor(CSV));
    expect(validateBackup(JSON.parse(JSON.stringify(await exportBackup(database)))).ok).toBe(true);
  });
});

describe('undoImport', () => {
  it('borra los movimientos de esa importación y las categorías que creó, sin tocar lo demás', async () => {
    await saveTransaction(database, { type: 'expense', accountId: pesos, amount: 100, date: '2026-10-01', description: 'Mío', categoryId: comida });
    const result = await importMovements(database, await planFor(CSV));
    expect(await database.transactions.count()).toBe(5);

    expect(await undoImport(database, result.importId, result.createdCategoryIds)).toBe(4);
    expect((await database.transactions.toArray()).map((t) => t.description)).toEqual(['Mío']);
    const names = (await database.categories.toArray()).map((c) => c.name);
    expect(names).not.toContain('Mascotas');
    expect(names).not.toContain('Veterinaria');
    expect(names).toContain('Comida');
  });

  it('conserva una categoría creada por la importación si después se usó en otro lado', async () => {
    const result = await importMovements(database, await planFor('Fecha;Monto;Categoría\n15/10/2026;-5;Gimnasio'));
    const gimnasio = (await database.categories.toArray()).find((c) => c.name === 'Gimnasio')!;
    await saveTransaction(database, { type: 'expense', accountId: pesos, amount: 9, date: '2026-10-20', description: 'Cuota', categoryId: gimnasio.id });
    await undoImport(database, result.importId, result.createdCategoryIds);
    expect(await database.categories.get(gimnasio.id)).toBeDefined();
    expect(await database.transactions.count()).toBe(1);
  });
});

describe('ciclo completo con el CSV que exporta la propia app', () => {
  it('exportar los movimientos e importarlos en una base vacía los reproduce (salvo transferencias y cuotas)', async () => {
    const sub = await saveCategory(database, { name: 'Super', kind: 'expense', parentId: comida });
    const sueldo = await saveCategory(database, { name: 'Sueldo', kind: 'income' });
    await saveTransaction(database, { type: 'expense', accountId: pesos, amount: 123_456, date: '2026-10-08', description: 'Coto; "el grande"', categoryId: sub });
    await saveTransaction(database, { type: 'income', accountId: pesos, amount: 800_000_00, date: '2026-10-05', description: 'Sueldo', categoryId: sueldo });
    await saveTransaction(database, { type: 'expense', accountId: usd, amount: 2_500, date: '2026-10-09', description: 'Curso', categoryId: comida });
    await saveTransaction(database, { type: 'transfer', accountId: pesos, toAccountId: usd, amount: 120_000, toAmount: 100, date: '2026-10-10', description: 'Compra USD' });
    const card = await saveCard(database, { name: 'Visa', defaultClosingDay: 10, defaultDueDay: 20, archived: false });
    await savePurchase(database, { cardId: card, date: '2026-10-15', description: 'TV', categoryId: comida, currency: 'ARS', installments: 3, amountMode: 'total', totalAmount: 90_000, startInstallment: 1, isRefund: false });

    const csv = await exportMovementsCSV(database);

    // base vacía con las mismas cuentas y categorías
    const other = new FinanzasDB(`dst-${crypto.randomUUID()}`);
    try {
      for (const a of await database.accounts.toArray()) await other.accounts.add(a);
      for (const c of await database.categories.toArray()) await other.categories.add(c);
      const { rows } = parseCSV(csv);
      const plan = buildImportPlan({
        rows: rows.slice(1), firstLine: 2, mapping: detectMapping(rows[0]!), options: options(),
        accounts: await other.accounts.toArray(), categories: await other.categories.toArray(), existing: [],
      });
      expect(plan.counts).toMatchObject({ ok: 3, skipped: 4, error: 0 }); // transferencia + 3 cuotas de tarjeta se saltean
      expect(plan.warnings).toEqual([]);
      await importMovements(other, plan);

      const strip = (t: { type: string; accountId: string; amount: number; date: string; description: string; categoryId?: string }) =>
        [t.type, t.accountId, t.amount, t.date, t.description, t.categoryId].join('|');
      const original = (await database.transactions.toArray()).filter((t) => t.type !== 'transfer').map(strip).sort();
      const imported = (await other.transactions.toArray()).map(strip).sort();
      expect(imported).toEqual(original);
    } finally {
      await other.delete();
    }
  });
});
