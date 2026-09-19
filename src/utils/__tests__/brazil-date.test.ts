import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { todayInBrazil, lastDayOfMonth, addDays, daysBetween, yearMonthOf } from '../brazil-date';

describe('todayInBrazil', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retorna o dia anterior quando UTC ja virou mas Brasilia nao', () => {
    vi.setSystemTime(new Date('2026-02-06T01:30:00Z')); // 05/02 22:30 em Brasilia
    expect(todayInBrazil()).toBe('2026-02-05');
  });

  it('retorna o mesmo dia quando os dois fusos coincidem', () => {
    vi.setSystemTime(new Date('2026-02-05T15:00:00Z')); // 05/02 12:00 em Brasilia
    expect(todayInBrazil()).toBe('2026-02-05');
  });
});

describe('lastDayOfMonth', () => {
  it('retorna 29 para fevereiro de ano bissexto', () => expect(lastDayOfMonth(2028, 2)).toBe('2028-02-29'));
  it('retorna 28 para fevereiro de ano comum', () => expect(lastDayOfMonth(2026, 2)).toBe('2026-02-28'));
  it('retorna 31 para dezembro', () => expect(lastDayOfMonth(2026, 12)).toBe('2026-12-31'));
});

describe('addDays', () => {
  it('atravessa a virada de mes', () => expect(addDays('2026-01-31', 5)).toBe('2026-02-05'));
  it('atravessa a virada de ano', () => expect(addDays('2026-12-31', 3)).toBe('2027-01-03'));
  it('com zero devolve a propria data', () => expect(addDays('2026-01-31', 0)).toBe('2026-01-31'));
});

describe('daysBetween', () => {
  it('retorna positivo quando to e depois de from', () => expect(daysBetween('2026-02-01', '2026-02-05')).toBe(4));
  it('retorna negativo quando to e antes de from', () => expect(daysBetween('2026-02-05', '2026-02-01')).toBe(-4));
  it('retorna zero para a mesma data', () => expect(daysBetween('2026-02-01', '2026-02-01')).toBe(0));
});

describe('yearMonthOf', () => {
  it('extrai ano e mes de uma data YYYY-MM-DD', () => {
    expect(yearMonthOf('2026-02-05')).toEqual({ year: 2026, month: 2 });
  });
});
