import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { expenseTemplates, expenseCategories } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: 'Template de despesa não encontrado.',
  FORBIDDEN: 'Você não tem permissão para alterar este template.',
} as const;

export async function listTemplates(userId: string) {
  const rows = await db.select({
    id: expenseTemplates.id,
    name: expenseTemplates.name,
    expenseCategoryId: expenseTemplates.expenseCategoryId,
    categoryName: expenseCategories.name,
    description: expenseTemplates.description,
    amount: expenseTemplates.amount,
    requiresReimbursement: expenseTemplates.requiresReimbursement,
  })
    .from(expenseTemplates)
    .leftJoin(expenseCategories, eq(expenseTemplates.expenseCategoryId, expenseCategories.id))
    .where(eq(expenseTemplates.userId, userId));

  return rows;
}

export async function createTemplate(userId: string, data: {
  name: string;
  expenseCategoryId?: string | null;
  description?: string;
  amount?: string;
  requiresReimbursement?: boolean;
}) {
  const [created] = await db.insert(expenseTemplates).values({
    userId,
    name: data.name,
    expenseCategoryId: data.expenseCategoryId || null,
    description: data.description || null,
    amount: data.amount || null,
    requiresReimbursement: data.requiresReimbursement ?? false,
  }).returning();
  return created;
}

export async function updateTemplate(id: string, userId: string, data: Partial<{
  name: string;
  expenseCategoryId: string | null;
  description: string;
  amount: string;
  requiresReimbursement: boolean;
}>) {
  const [existing] = await db.select({ id: expenseTemplates.id, userId: expenseTemplates.userId })
    .from(expenseTemplates)
    .where(eq(expenseTemplates.id, id))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);
  if (existing.userId !== userId) throw new AppError(MSG.FORBIDDEN, 403);

  const [updated] = await db.update(expenseTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(expenseTemplates.id, id))
    .returning();
  return updated;
}

export async function deleteTemplate(id: string, userId: string) {
  const [existing] = await db.select({ id: expenseTemplates.id, userId: expenseTemplates.userId })
    .from(expenseTemplates)
    .where(eq(expenseTemplates.id, id))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);
  if (existing.userId !== userId) throw new AppError(MSG.FORBIDDEN, 403);

  await db.delete(expenseTemplates).where(eq(expenseTemplates.id, id));
}
