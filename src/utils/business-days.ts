/**
 * Calcula a data de fim a partir de uma data de início e quantidade de dias úteis.
 * Exclui apenas sábados e domingos (sem feriados).
 */
export function calculateEndDate(startDate: string, businessDays: number): string {
  const date = new Date(startDate + 'T12:00:00');
  let remaining = businessDays;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }

  return date.toISOString().split('T')[0];
}
