const BRAZIL_TZ = 'America/Sao_Paulo';

/** Data de hoje no fuso de Brasilia, formato YYYY-MM-DD. */
export function todayInBrazil(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZIL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Ultimo dia do mes (month 1-12), formato YYYY-MM-DD. Ancorado em UTC. */
export function lastDayOfMonth(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0];
}

/** Soma dias corridos a uma data YYYY-MM-DD. Ancorado em UTC. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** Dias corridos de `from` ate `to` (ambos YYYY-MM-DD). Negativo se `to` < `from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** year/month a partir de YYYY-MM-DD, por parsing de string (sem Date, sem fuso). */
export function yearMonthOf(dateStr: string): { year: number; month: number } {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, month };
}
