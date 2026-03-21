import { z } from 'zod';
import type { PaginationParams, PaginationMeta } from '../types/pagination.types';

export const paginationSchema = z.object({
  page: z.coerce.number().int('Pagina deve ser um numero inteiro').min(1, 'Pagina deve ser no minimo 1').default(1),
  limit: z.coerce.number().int('Limite deve ser um numero inteiro').min(1, 'Limite deve ser no minimo 1').max(100, 'Limite deve ser no maximo 100').default(20),
});

export function buildMeta(total: number, params: PaginationParams): PaginationMeta {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.ceil(total / params.limit),
  };
}
