/**
 * Escapa caracteres especiais do LIKE/ILIKE do PostgreSQL.
 * Previne que input do usuário use `%` ou `_` como wildcards.
 */
export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
