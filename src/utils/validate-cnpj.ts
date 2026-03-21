/**
 * Valida CNPJ verificando os digitos verificadores (algoritmo modulo 11).
 * Aceita CNPJ formatado (XX.XXX.XXX/XXXX-XX) ou apenas digitos (14 chars).
 */
export function validateCnpj(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');

  if (digits.length !== 14) return false;

  // Rejeitar CNPJs com todos os digitos iguais
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const nums = digits.split('').map(Number);

  // Primeiro digito verificador
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += nums[i] * weights1[i];
  }
  let remainder = sum % 11;
  const d1 = remainder < 2 ? 0 : 11 - remainder;

  if (nums[12] !== d1) return false;

  // Segundo digito verificador
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += nums[i] * weights2[i];
  }
  remainder = sum % 11;
  const d2 = remainder < 2 ? 0 : 11 - remainder;

  return nums[13] === d2;
}
