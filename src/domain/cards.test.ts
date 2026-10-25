import { describe, expect, it } from 'vitest';
import {
  activePurchases,
  advanceInstallments,
  availableLimit,
  defaultStatementDates,
  futureCommitments,
  generateInstallments,
  normalizePurchase,
  periodForPurchase,
  previewPurchase,
  reassignPurchases,
  resolveStatement,
  statementSummary,
  validatePurchase,
} from './cards';
import type { Card, CardPurchase, Installment, Statement, StatementPayment } from './types';

const card = (closing: number, due: number, extra: Partial<Card> = {}): Card => ({
  id: 'visa',
  name: 'Visa',
  defaultClosingDay: closing,
  defaultDueDay: due,
  archived: false,
  ...extra,
});

let seq = 0;
const ids = () => `id${++seq}`;

const purchase = (extra: Partial<CardPurchase> = {}): CardPurchase => ({
  id: 'p1',
  cardId: 'visa',
  date: '2026-10-05',
  description: 'TV',
  categoryId: 'tec',
  currency: 'ARS',
  installments: 1,
  amountMode: 'total',
  totalAmount: 100_000,
  startInstallment: 1,
  isRefund: false,
  ...extra,
});

const installment = (extra: Partial<Installment>): Installment => ({
  id: ids(),
  purchaseId: 'p1',
  cardId: 'visa',
  number: 1,
  of: 1,
  period: '2026-11',
  amount: 1000,
  currency: 'ARS',
  categoryId: 'tec',
  status: 'scheduled',
  ...extra,
});

const statement = (period: string, closingDate: string, dueDate: string, id = `s-${period}`): Statement => ({
  id,
  cardId: 'visa',
  period,
  closingDate,
  dueDate,
});

describe('T1: compra en el día del cierre vs. el día siguiente', () => {
  // Cierre día 10, vencimiento día 20: el resumen de octubre cierra el 10/10.
  const c = card(10, 20);

  it('el día del cierre cae en ese resumen', () => {
    expect(periodForPurchase(c, [], '2026-10-10')).toBe('2026-10');
  });

  it('el día siguiente cae en el próximo', () => {
    expect(periodForPurchase(c, [], '2026-10-11')).toBe('2026-11');
  });

  it('el primer día del mes y el último día del cierre anterior', () => {
    expect(periodForPurchase(c, [], '2026-10-01')).toBe('2026-10');
    expect(periodForPurchase(c, [], '2026-09-11')).toBe('2026-10');
    expect(periodForPurchase(c, [], '2026-09-10')).toBe('2026-09');
  });

  it('respeta firstPeriodOverride', () => {
    expect(periodForPurchase(c, [], '2026-10-10', '2027-03')).toBe('2027-03');
  });
});

describe('T2: cierre día 31 en meses cortos y febrero', () => {
  // Cierre 31 > vencimiento 10: el cierre cae en el mes anterior al período.
  const c = card(31, 10);

  it('mes de 30 días', () => {
    expect(defaultStatementDates(c, '2026-05').closingDate).toBe('2026-04-30');
    expect(defaultStatementDates(c, '2026-12').closingDate).toBe('2026-11-30');
  });

  it('febrero no bisiesto y bisiesto', () => {
    expect(defaultStatementDates(c, '2026-03').closingDate).toBe('2026-02-28');
    expect(defaultStatementDates(c, '2028-03').closingDate).toBe('2028-02-29');
  });

  it('mes de 31 días conserva el 31', () => {
    expect(defaultStatementDates(c, '2026-04').closingDate).toBe('2026-03-31');
  });

  it('cierre 31 con vencimiento 31 (mismo mes) también se recorta', () => {
    expect(defaultStatementDates(card(31, 31), '2026-02')).toEqual({ closingDate: '2026-02-28', dueDate: '2026-02-28' });
  });

  it('una compra del 30/04 cae en el resumen que cierra el 30/04; la del 01/05 en el que cierra el 31/05', () => {
    expect(periodForPurchase(c, [], '2026-04-30')).toBe('2026-05');
    expect(periodForPurchase(c, [], '2026-05-01')).toBe('2026-06');
    expect(periodForPurchase(c, [], '2026-05-31')).toBe('2026-06');
    expect(periodForPurchase(c, [], '2026-06-01')).toBe('2026-07');
  });
});

describe('T3: cierre 25 y vencimiento 5', () => {
  const c = card(25, 5);

  it('el resumen de marzo cierra el 25 de febrero y vence el 5 de marzo', () => {
    expect(defaultStatementDates(c, '2026-03')).toEqual({ closingDate: '2026-02-25', dueDate: '2026-03-05' });
  });

  it('cambio de año: el resumen de enero cierra el 25 de diciembre', () => {
    expect(defaultStatementDates(c, '2027-01')).toEqual({ closingDate: '2026-12-25', dueDate: '2027-01-05' });
  });

  it('una compra del 25/02 va al resumen de marzo; la del 26/02 al de abril', () => {
    expect(periodForPurchase(c, [], '2026-02-25')).toBe('2026-03');
    expect(periodForPurchase(c, [], '2026-02-26')).toBe('2026-04');
  });
});

describe('T4: resumen con closingDate editada a mano', () => {
  const c = card(10, 20);

  it('el resumen guardado manda sobre el default', () => {
    const edited = [statement('2026-10', '2026-10-15', '2026-10-25')];
    expect(resolveStatement(c, edited, '2026-10')).toMatchObject({ closingDate: '2026-10-15', dueDate: '2026-10-25' });
    expect(resolveStatement(c, edited, '2026-11')).toMatchObject({ closingDate: '2026-11-10' });
  });

  it('las compras entre el cierre original y el editado cambian de resumen', () => {
    expect(periodForPurchase(c, [], '2026-10-12')).toBe('2026-11');
    const edited = [statement('2026-10', '2026-10-15', '2026-10-25')];
    expect(periodForPurchase(c, edited, '2026-10-12')).toBe('2026-10');
    expect(periodForPurchase(c, edited, '2026-10-15')).toBe('2026-10');
    expect(periodForPurchase(c, edited, '2026-10-16')).toBe('2026-11');
  });

  it('adelantar el cierre pasa compras al resumen siguiente', () => {
    const edited = [statement('2026-10', '2026-10-05', '2026-10-20')];
    expect(periodForPurchase(c, edited, '2026-10-08')).toBe('2026-11');
  });

  it('reassignPurchases corre todas las cuotas de la compra la misma cantidad de meses', () => {
    const p = purchase({ date: '2026-10-12', installments: 3 });
    const before = generateInstallments(p, periodForPurchase(c, [], p.date), ids);
    expect(before.map((i) => i.period)).toEqual(['2026-11', '2026-12', '2027-01']);

    const edited = [statement('2026-10', '2026-10-15', '2026-10-25')];
    const updates = reassignPurchases(c, edited, [p], before);
    expect(updates.map((u) => u.period)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(updates.map((u) => u.installmentId)).toEqual(before.map((i) => i.id));
  });

  it('reassignPurchases no toca lo que no cambió, lo forzado ni lo adelantado', () => {
    const stays = purchase({ id: 'stays', date: '2026-10-01' });
    const forced = purchase({ id: 'forced', date: '2026-10-12', firstPeriodOverride: '2026-11' });
    const advanced = purchase({ id: 'adv', date: '2026-10-12', installments: 2 });
    const installments = [
      installment({ purchaseId: 'stays', period: '2026-10' }),
      installment({ purchaseId: 'forced', period: '2026-11' }),
      installment({ purchaseId: 'adv', period: '2026-11', number: 1, of: 2 }),
      installment({ purchaseId: 'adv', period: '2026-12', number: 2, of: 2, status: 'cancelled' }),
    ];
    const edited = [statement('2026-10', '2026-10-15', '2026-10-25')];
    expect(reassignPurchases(c, edited, [stays, forced, advanced], installments)).toEqual([]);
  });
});

describe('T5: reparto de cuotas', () => {
  it('$100.000 en 3 cuotas → 33.334 + 33.333 + 33.333 (en centavos, suma exacta)', () => {
    const items = generateInstallments(purchase({ installments: 3, totalAmount: 10_000_000 }), '2026-11', ids);
    expect(items.map((i) => i.amount)).toEqual([3_333_334, 3_333_333, 3_333_333]);
    expect(items.reduce((s, i) => s + i.amount, 0)).toBe(10_000_000);
  });

  it('una sola cuota', () => {
    const [only] = generateInstallments(purchase({ totalAmount: 12_345 }), '2026-11', ids);
    expect(only).toMatchObject({ number: 1, of: 1, amount: 12_345, period: '2026-11', status: 'scheduled' });
  });

  it('modo por cuota: todas iguales y total = cuota × N', () => {
    const p = purchase({ installments: 6, amountMode: 'perInstallment', installmentAmount: 1_666_700, totalAmount: 0 });
    const items = generateInstallments(p, '2026-11', ids);
    expect(items.map((i) => i.amount)).toEqual(Array(6).fill(1_666_700));
    expect(normalizePurchase(p).totalAmount).toBe(10_000_200);
  });

  it('hereda categoría, moneda, tarjeta y compra', () => {
    const [i] = generateInstallments(purchase({ categoryId: 'ropa', currency: 'USD', installments: 2 }), '2026-11', ids);
    expect(i).toMatchObject({ categoryId: 'ropa', currency: 'USD', cardId: 'visa', purchaseId: 'p1' });
  });
});

describe('T6: cuotas que cruzan de año', () => {
  it('diciembre → enero → febrero', () => {
    const items = generateInstallments(purchase({ installments: 4, totalAmount: 400 }), '2026-11', ids);
    expect(items.map((i) => i.period)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(items.map((i) => i.number)).toEqual([1, 2, 3, 4]);
  });

  it('12 cuotas arrancando en diciembre terminan en noviembre del año siguiente', () => {
    const items = generateInstallments(purchase({ installments: 12, totalAmount: 1200 }), '2026-12', ids);
    expect(items[0]!.period).toBe('2026-12');
    expect(items[11]!.period).toBe('2027-11');
  });
});

describe('T7: compra cargada en la cuota 4 de 12', () => {
  it('genera 9 cuotas (4..12) desde el período indicado', () => {
    const p = purchase({ installments: 12, totalAmount: 1_200_000, startInstallment: 4 });
    const items = generateInstallments(p, '2026-11', ids);
    expect(items).toHaveLength(9);
    expect(items.map((i) => i.number)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(items.every((i) => i.of === 12)).toBe(true);
    expect(items[0]!.period).toBe('2026-11');
    expect(items[8]!.period).toBe('2027-07');
  });

  it('el resto del redondeo es de la cuota 1, que ya no se genera', () => {
    const p = purchase({ installments: 3, totalAmount: 100, startInstallment: 2 });
    expect(generateInstallments(p, '2026-11', ids).map((i) => i.amount)).toEqual([33, 33]);
  });
});

describe('T8: devolución en cuotas', () => {
  it('resta en cada resumen y la suma da exacta en negativo', () => {
    const items = generateInstallments(purchase({ installments: 3, totalAmount: 10_000, isRefund: true }), '2026-11', ids);
    expect(items.map((i) => i.amount)).toEqual([-3_334, -3_333, -3_333]);
    expect(items.reduce((s, i) => s + i.amount, 0)).toBe(-10_000);
  });

  it('en el resumen resta del total', () => {
    const c = card(10, 20);
    const items = [
      ...generateInstallments(purchase({ id: 'a', installments: 2, totalAmount: 20_000 }), '2026-11', ids),
      ...generateInstallments(purchase({ id: 'b', installments: 2, totalAmount: 6_000, isRefund: true }), '2026-11', ids),
    ];
    const s = statementSummary(c, [], items, [], '2026-11', '2026-10-01');
    expect(s.totalARS).toBe(10_000 - 3_000);
  });
});

describe('T9: adelanto de cuotas', () => {
  const items = generateInstallments(purchase({ installments: 6, totalAmount: 60_000 }), '2026-11', ids);

  it('cancela las posteriores al resumen elegido y crea una cuota por la suma', () => {
    const { cancelledIds, merged } = advanceInstallments(items, '2026-12', ids);
    // quedan intactas 2026-11 y 2026-12; se adelantan las 4 últimas
    expect(cancelledIds).toEqual(items.slice(2).map((i) => i.id));
    expect(merged).toMatchObject({ period: '2026-12', amount: 40_000, number: 6, of: 6, status: 'scheduled', purchaseId: 'p1' });
  });

  it('el total del resumen elegido suma la cuota normal más la adelantada, y los futuros quedan en cero', () => {
    const c = card(10, 20);
    const { cancelledIds, merged } = advanceInstallments(items, '2026-12', ids);
    const after = items.map((i) => (cancelledIds.includes(i.id) ? { ...i, status: 'cancelled' as const } : i)).concat(merged);
    const totalAt = (period: string) => statementSummary(c, [], after, [], period, '2026-10-01').totalARS;
    expect(totalAt('2026-11')).toBe(10_000);
    expect(totalAt('2026-12')).toBe(10_000 + 40_000);
    expect(totalAt('2027-01')).toBe(0);
    expect(after.filter((i) => i.status === 'scheduled').reduce((s, i) => s + i.amount, 0)).toBe(60_000);
  });

  it('con moneda y categoría de la compra', () => {
    const usd = generateInstallments(purchase({ installments: 3, totalAmount: 300, currency: 'USD', categoryId: 'viajes' }), '2026-11', ids);
    expect(advanceInstallments(usd, '2026-11', ids).merged).toMatchObject({ currency: 'USD', categoryId: 'viajes', amount: 200 });
  });

  it('no repite el adelanto sobre cuotas ya canceladas', () => {
    const { cancelledIds, merged } = advanceInstallments(items, '2026-12', ids);
    const after = items.map((i) => (cancelledIds.includes(i.id) ? { ...i, status: 'cancelled' as const } : i)).concat(merged);
    expect(() => advanceInstallments(after, '2026-12', ids)).toThrow();
  });

  it('error si no hay cuotas posteriores', () => {
    expect(() => advanceInstallments(items, '2027-04', ids)).toThrow(RangeError);
  });
});

describe('T10: saldo arrastrado con pago parcial', () => {
  const c = card(10, 20);
  const installments = [
    installment({ period: '2026-11', amount: 100_000 }),
    installment({ period: '2026-12', amount: 50_000 }),
  ];
  const statements = [statement('2026-11', '2026-11-10', '2026-11-20', 's-nov')];
  const payment = (amountARS: number, amountUSD = 0): StatementPayment => ({
    id: ids(),
    statementId: 's-nov',
    accountId: 'banco',
    date: '2026-11-18',
    amountARS,
    amountUSD,
  });

  it('el impago del resumen anterior aparece como línea aparte y se suma a lo que queda', () => {
    const dec = statementSummary(c, statements, installments, [payment(40_000)], '2026-12', '2026-12-01');
    expect(dec.previousBalanceARS).toBe(60_000);
    expect(dec.totalARS).toBe(50_000);
    expect(dec.remainingARS).toBe(110_000);
  });

  it('el resumen pagado parcialmente muestra lo pagado y lo que falta', () => {
    const nov = statementSummary(c, statements, installments, [payment(40_000)], '2026-11', '2026-11-15');
    expect(nov).toMatchObject({ totalARS: 100_000, paidARS: 40_000, remainingARS: 60_000, previousBalanceARS: 0 });
  });

  it('sin pagos se arrastra todo; pagado por completo no arrastra nada', () => {
    expect(statementSummary(c, statements, installments, [], '2026-12', '2026-12-01').previousBalanceARS).toBe(100_000);
    expect(statementSummary(c, statements, installments, [payment(100_000)], '2026-12', '2026-12-01').previousBalanceARS).toBe(0);
  });

  it('se arrastra en cadena a través de varios resúmenes', () => {
    const more = [...installments, installment({ period: '2027-01', amount: 10_000 })];
    expect(statementSummary(c, statements, more, [payment(40_000)], '2027-01', '2027-01-01').previousBalanceARS).toBe(110_000);
  });

  it('no se arrastra mientras el resumen anterior no venció (evita contar la deuda dos veces)', () => {
    // hoy es 20/11, último día para pagar noviembre: diciembre todavía no hereda nada
    expect(statementSummary(c, statements, installments, [payment(40_000)], '2026-12', '2026-11-20').previousBalanceARS).toBe(0);
    // un día después ya venció impago y pasa a ser saldo anterior
    expect(statementSummary(c, statements, installments, [payment(40_000)], '2026-12', '2026-11-21').previousBalanceARS).toBe(60_000);
    // mirando meses lejanos hoy, nada de lo futuro se arrastra
    expect(statementSummary(c, statements, installments, [], '2027-03', '2026-10-01').previousBalanceARS).toBe(0);
  });

  it('un pago de más no genera saldo negativo en el siguiente', () => {
    const dec = statementSummary(c, statements, installments, [payment(130_000)], '2026-12', '2026-12-01');
    expect(dec.previousBalanceARS).toBe(0);
  });

  it('los pagos de otra tarjeta no cuentan', () => {
    const other: Statement = { ...statement('2026-11', '2026-11-10', '2026-11-20', 'other'), cardId: 'master' };
    const p: StatementPayment = { ...payment(100_000), statementId: 'other' };
    const nov = statementSummary(c, [other], installments, [p], '2026-11', '2026-11-15');
    expect(nov.paidARS).toBe(0);
  });

  describe('estados', () => {
    const status = (todayDate: string, pays: StatementPayment[] = []) =>
      statementSummary(c, statements, installments, pays, '2026-11', todayDate).status;

    it('open hasta el día del cierre inclusive', () => {
      expect(status('2026-11-10')).toBe('open');
    });
    it('closed: cerrado, sin pagar, dentro de plazo', () => {
      expect(status('2026-11-11')).toBe('closed');
      expect(status('2026-11-20')).toBe('closed');
    });
    it('partial: pago parcial dentro de plazo', () => {
      expect(status('2026-11-15', [payment(10_000)])).toBe('partial');
    });
    it('paid: sin saldo', () => {
      expect(status('2026-11-15', [payment(100_000)])).toBe('paid');
    });
    it('overdue: vencido con saldo, aunque haya pago parcial', () => {
      expect(status('2026-11-21')).toBe('overdue');
      expect(status('2026-11-21', [payment(10_000)])).toBe('overdue');
    });
    it('vencido pero pagado es paid', () => {
      expect(status('2026-11-21', [payment(100_000)])).toBe('paid');
    });
  });
});

describe('T11: compras en USD', () => {
  const c = card(10, 20);

  it('no se mezclan con el total en pesos', () => {
    const items = [
      ...generateInstallments(purchase({ id: 'a', installments: 2, totalAmount: 20_000 }), '2026-11', ids),
      ...generateInstallments(purchase({ id: 'b', installments: 2, totalAmount: 5_000, currency: 'USD' }), '2026-11', ids),
    ];
    const s = statementSummary(c, [], items, [], '2026-11', '2026-10-01');
    expect(s.totalARS).toBe(10_000);
    expect(s.totalUSD).toBe(2_500);
  });

  it('el saldo anterior tampoco mezcla monedas', () => {
    const items = [
      installment({ period: '2026-11', amount: 7_000, currency: 'USD' }),
      installment({ period: '2026-12', amount: 1_000, currency: 'ARS' }),
    ];
    const dec = statementSummary(c, [], items, [], '2026-12', '2026-12-01');
    expect(dec).toMatchObject({ previousBalanceUSD: 7_000, previousBalanceARS: 0, totalARS: 1_000, totalUSD: 0 });
  });

  it('el límite disponible solo descuenta pesos', () => {
    const k = card(10, 20, { limit: 1_000_000 });
    const items = [installment({ amount: 300_000 }), installment({ amount: 999_999, currency: 'USD' })];
    expect(availableLimit(k, [], items, [])).toBe(700_000);
  });
});

describe('compromiso futuro', () => {
  const items = [
    installment({ period: '2026-11', amount: 100 }),
    installment({ period: '2026-11', amount: 50, cardId: 'master' }),
    installment({ period: '2026-12', amount: 100 }),
    installment({ period: '2026-12', amount: 7, currency: 'USD' }),
    installment({ period: '2027-01', amount: 999, status: 'cancelled' }),
    installment({ period: '2025-01', amount: 999 }),
    installment({ period: '2030-01', amount: 999 }),
  ];

  it('suma por mes y por tarjeta, solo cuotas programadas dentro de la ventana', () => {
    const months = futureCommitments(items, '2026-11', 3);
    expect(months.map((m) => m.period)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(months[0]).toMatchObject({ totalARS: 150, byCard: { visa: { ARS: 100, USD: 0 }, master: { ARS: 50, USD: 0 } } });
    expect(months[1]).toMatchObject({ totalARS: 100, totalUSD: 7 });
    expect(months[2]).toMatchObject({ totalARS: 0, totalUSD: 0 });
  });

  it('12 meses por defecto', () => {
    expect(futureCommitments([], '2026-11')).toHaveLength(12);
  });
});

describe('límite disponible', () => {
  it('sin límite configurado no hay disponible', () => {
    expect(availableLimit({ id: 'visa' }, [], [], [])).toBeUndefined();
  });

  it('descuenta todas las cuotas pendientes y libera lo pagado', () => {
    const k = card(10, 20, { limit: 1_000_000 });
    const items = [installment({ period: '2026-11', amount: 100_000 }), installment({ period: '2027-05', amount: 200_000 }), installment({ amount: 50_000, status: 'cancelled' })];
    const sts = [statement('2026-11', '2026-11-10', '2026-11-20', 's-nov')];
    const pay: StatementPayment = { id: 'x', statementId: 's-nov', accountId: 'a', date: '2026-11-18', amountARS: 40_000, amountUSD: 0 };
    expect(availableLimit(k, sts, items, [])).toBe(700_000);
    expect(availableLimit(k, sts, items, [pay])).toBe(740_000);
  });
});

describe('cuotas pendientes', () => {
  const six = generateInstallments(purchase({ installments: 6, totalAmount: 60_000, description: 'TV' }), '2026-09', ids);
  const done = generateInstallments(purchase({ id: 'p2', installments: 2, totalAmount: 2_000, description: 'Zapatillas' }), '2026-07', ids);
  const single = generateInstallments(purchase({ id: 'p3', description: 'Café' }), '2026-11', ids);
  const all = [...six, ...done, ...single];
  const purchases = [purchase({ installments: 6, description: 'TV' }), purchase({ id: 'p2', installments: 2, description: 'Zapatillas' }), purchase({ id: 'p3', description: 'Café' })];

  it('lista solo compras en cuotas con cuotas por pagar, con cuota actual y monto restante', () => {
    const active = activePurchases(purchases, all, '2026-11');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ currentNumber: 3, remaining: 40_000, lastPeriod: '2027-02' });
  });
});

describe('validatePurchase', () => {
  const ok = purchase({ installments: 3 });

  it('compra válida', () => {
    expect(validatePurchase(ok)).toEqual([]);
  });

  it.each([
    [{ installments: 0 }, 'cuotas'],
    [{ installments: 2.5 }, 'cuotas'],
    [{ installments: 3, startInstallment: 4 }, 'cuota inicial'],
    [{ totalAmount: 0 }, 'monto'],
    [{ amountMode: 'perInstallment' as const, installmentAmount: undefined }, 'monto'],
    [{ date: '2026-02-30' }, 'fecha'],
    [{ categoryId: '' }, 'categoría'],
    [{ firstPeriodOverride: '2026-13' }, 'resumen'],
  ])('rechaza %j', (extra, fragment) => {
    const errors = validatePurchase({ ...ok, ...extra });
    expect(errors.join(' ').toLowerCase()).toContain(fragment);
  });
});

describe('preview de la carga rápida', () => {
  const c = card(10, 20);

  it('6 cuotas con primera y última', () => {
    const p = purchase({ date: '2026-10-20', installments: 6, totalAmount: 10_000_200 });
    const preview = previewPurchase(p, c, []);
    expect(preview.text).toBe('6 cuotas de $ 16.667 — primera en resumen de Noviembre 2026, última en Abril 2027');
    expect(preview).toMatchObject({ count: 6, firstPeriod: '2026-11', lastPeriod: '2027-04' });
  });

  it('avisa cuando la primera cuota difiere por redondeo', () => {
    const p = purchase({ date: '2026-10-20', installments: 3, totalAmount: 10_000_000 });
    expect(previewPurchase(p, c, []).text).toContain('(la primera de $ 33.333,34)');
  });

  it('un solo pago', () => {
    const p = purchase({ date: '2026-10-10', totalAmount: 500_000 });
    expect(previewPurchase(p, c, []).text).toBe('1 pago de $ 5.000 en el resumen de Octubre 2026');
  });

  it('devolución y primer resumen forzado', () => {
    const p = purchase({ date: '2026-10-10', isRefund: true, firstPeriodOverride: '2027-01', totalAmount: 500_000 });
    expect(previewPurchase(p, c, []).text).toBe('devolución de 1 pago de $ 5.000 en el resumen de Enero 2027');
  });
});
