import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateInPeriod,
  daysInMonth,
  diffDays,
  formatDate,
  formatPeriod,
  isValidDate,
  monthsBetween,
  periodOf,
  today,
} from './dates';

describe('daysInMonth y dateInPeriod', () => {
  it('febrero bisiesto y no bisiesto', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('día 31 se recorta al último día del mes', () => {
    expect(dateInPeriod('2026-04', 31)).toBe('2026-04-30');
    expect(dateInPeriod('2026-02', 31)).toBe('2026-02-28');
    expect(dateInPeriod('2028-02', 31)).toBe('2028-02-29');
    expect(dateInPeriod('2026-01', 31)).toBe('2026-01-31');
    expect(dateInPeriod('2026-03', 5)).toBe('2026-03-05');
  });
});

describe('períodos', () => {
  it('addMonths cruza el cambio de año en ambos sentidos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(addMonths('2026-10', -22)).toBe('2024-12');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('monthsBetween', () => {
    expect(monthsBetween('2026-11', '2027-04')).toBe(5);
    expect(monthsBetween('2027-04', '2026-11')).toBe(-5);
  });

  it('periodOf', () => {
    expect(periodOf('2026-10-17')).toBe('2026-10');
  });

  it('formatPeriod', () => {
    expect(formatPeriod('2026-11')).toBe('Noviembre 2026');
    expect(formatPeriod('2027-04')).toBe('Abril 2027');
  });
});

describe('días', () => {
  it('addDays cruza meses, años y febrero', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('diffDays', () => {
    expect(diffDays('2026-10-17', '2026-11-05')).toBe(19);
    expect(diffDays('2026-11-05', '2026-10-17')).toBe(-19);
  });

  it('validación', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
  });

  it('formatDate en es-AR', () => {
    expect(formatDate('2026-10-12')).toBe('12/10/2026');
  });

  it('today usa la hora de Buenos Aires (UTC-3)', () => {
    // 02:00 UTC del 18/10 todavía es 17/10 en Buenos Aires
    expect(today(new Date(Date.UTC(2026, 9, 18, 2, 0)))).toBe('2026-10-17');
    expect(today(new Date(Date.UTC(2026, 9, 18, 3, 0)))).toBe('2026-10-18');
  });
});
