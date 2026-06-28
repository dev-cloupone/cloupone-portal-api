import { eq, asc, desc } from 'drizzle-orm';
import { db } from '../db';
import { expenseCategoryTemplates } from '../db/schema';
import { appError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: { message: 'Categoria de despesa não encontrada.', code: 'EXPENSE_CATEGORY_NOT_FOUND' },
  NAME_IN_USE: { message: 'Já existe uma categoria de despesa com este nome.', code: 'EXPENSE_CATEGORY_NAME_IN_USE' },
  ALREADY_ACTIVE: { message: 'Categoria de despesa já está ativa.', code: 'EXPENSE_CATEGORY_ALREADY_ACTIVE' },
} as const;

export async function listCategories() {
  return db.select()
    .from(expenseCategoryTemplates)
    .orderBy(desc(expenseCategoryTemplates.isActive), asc(expenseCategoryTemplates.name));
}

export async function getCategoryById(id: string) {
  const [category] = await db.select()
    .from(expenseCategoryTemplates)
    .where(eq(expenseCategoryTemplates.id, id))
    .limit(1);
  if (!category) throw appError(MSG.NOT_FOUND, 404);
  return category;
}

export async function createCategory(data: {
  name: string;
  description?: string;
  defaultMaxAmount?: string;
  defaultKmRate?: string;
  requiresReceipt?: boolean;
  isKmCategory?: boolean;
}) {
  const [existing] = await db.select({ id: expenseCategoryTemplates.id })
    .from(expenseCategoryTemplates)
    .where(eq(expenseCategoryTemplates.name, data.name))
    .limit(1);
  if (existing) throw appError(MSG.NAME_IN_USE, 409);

  const [created] = await db.insert(expenseCategoryTemplates).values(data).returning();
  return created;
}

export async function updateCategory(id: string, data: Partial<{
  name: string;
  description: string;
  defaultMaxAmount: string;
  defaultKmRate: string;
  requiresReceipt: boolean;
  isKmCategory: boolean;
}>) {
  const [existing] = await db.select({ id: expenseCategoryTemplates.id })
    .from(expenseCategoryTemplates)
    .where(eq(expenseCategoryTemplates.id, id))
    .limit(1);
  if (!existing) throw appError(MSG.NOT_FOUND, 404);

  if (data.name) {
    const [nameTaken] = await db.select({ id: expenseCategoryTemplates.id })
      .from(expenseCategoryTemplates)
      .where(eq(expenseCategoryTemplates.name, data.name))
      .limit(1);
    if (nameTaken && nameTaken.id !== id) throw appError(MSG.NAME_IN_USE, 409);
  }

  const [updated] = await db.update(expenseCategoryTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(expenseCategoryTemplates.id, id))
    .returning();
  return updated;
}

export async function deactivateCategory(id: string) {
  const [existing] = await db.select({ id: expenseCategoryTemplates.id })
    .from(expenseCategoryTemplates)
    .where(eq(expenseCategoryTemplates.id, id))
    .limit(1);
  if (!existing) throw appError(MSG.NOT_FOUND, 404);

  const [updated] = await db.update(expenseCategoryTemplates)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(expenseCategoryTemplates.id, id))
    .returning();
  return updated;
}

export async function reactivateCategory(id: string) {
  const [existing] = await db.select({ id: expenseCategoryTemplates.id, isActive: expenseCategoryTemplates.isActive })
    .from(expenseCategoryTemplates)
    .where(eq(expenseCategoryTemplates.id, id))
    .limit(1);
  if (!existing) throw appError(MSG.NOT_FOUND, 404);
  if (existing.isActive) throw appError(MSG.ALREADY_ACTIVE, 409);

  const [updated] = await db.update(expenseCategoryTemplates)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(expenseCategoryTemplates.id, id))
    .returning();
  return updated;
}
