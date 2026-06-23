/**
 * Formata número como moeda BRL sem depender de locale do sistema.
 * Ex: 50000 → "50.000,00"
 */
export function formatBRL(value: number): string {
  const fixed = value.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots},${decPart}`;
}
