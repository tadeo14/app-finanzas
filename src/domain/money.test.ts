import { describe, expect, it } from 'vitest';
import { convert, formatMoney, formatMoneyShort, parseMoney, splitEvenly, sumCents } from './money';

describe('formatMoney', () => {
  it('formatea en es-AR con miles y decimales', () => {
    expect(formatMoney(123456)).toBe('$ 1.234,56');
    expect(formatMoney(0)).toBe('$ 0,00');
    expect(formatMoney(5)).toBe('$ 0,05');
    expect(formatMoney(10000000000)).toBe('$ 100.000.000,00');
  });

  it('muestra negativos y dólares', () => {
    expect(formatMoney(-123456)).toBe('-$ 1.234,56');
    expect(formatMoney(99, 'USD')).toBe('US$ 0,99');
  });

  it('versión corta omite ,00', () => {
    expect(formatMoneyShort(1666700)).toBe('$ 16.667');
    expect(formatMoneyShort(1666750)).toBe('$ 16.667,50');
  });

  it('rechaza montos no enteros', () => {
    expect(() => formatMoney(1.5)).toThrow();
  });
});

describe('parseMoney', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234,5', 123450],
    ['1234', 123400],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['1234.56', 123456],
    ['$ 1.000', 100000],
    ['US$ 10,25', 1025],
    [',5', 50],
    ['0,01', 1],
    ['-50', -5000],
    ['  100  ', 10000],
  ])('%s → %i', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '1,234', '12.34.5', '1.2345'])('"%s" es inválido', (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it('"1," (estado intermedio al tipear) vale 1 peso', () => {
    expect(parseMoney('1,')).toBe(100);
  });
});

describe('splitEvenly', () => {
  it('$100.000 en 3 → 33.334 + 33.333 + 33.333, suma exacta', () => {
    const parts = splitEvenly(10_000_000, 3);
    expect(parts).toEqual([3_333_334, 3_333_333, 3_333_333]);
    expect(sumCents(parts)).toBe(10_000_000);
  });

  it('negativos mantienen la suma exacta', () => {
    const parts = splitEvenly(-1000, 3);
    expect(parts).toEqual([-334, -333, -333]);
    expect(sumCents(parts)).toBe(-1000);
  });

  it('total menor que n', () => {
    expect(splitEvenly(2, 3)).toEqual([2, 0, 0]);
  });

  it('n inválido', () => {
    expect(() => splitEvenly(100, 0)).toThrow();
  });
});

describe('convert', () => {
  it('redondea al centavo', () => {
    expect(convert(1000, 1234.5)).toBe(1234500);
    expect(convert(1, 0.333)).toBe(0);
    expect(convert(333, 1.5)).toBe(500);
  });

  it('cotización inválida', () => {
    expect(() => convert(100, 0)).toThrow();
  });
});
