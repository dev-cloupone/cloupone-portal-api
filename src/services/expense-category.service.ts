import { eq, asc, desc } from 'drizzle-orm';
import { db } from '../db';
import { expenseCategoryTemplates } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: 'Categoria de despesa não encontrada.',
  NAME_IN_USE: 'Já existe uma categoria de despesa com este nome.',
  ALREADY_ACTIVE: 'Categoria de despesa já está ativa.',
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
  if (!category) throw new AppError(MSG.NOT_FOUND, 404);
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
  if (existing) throw new AppError(MSG.NAME_IN_USE, 409);

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
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

  if (data.name) {
    const [nameTaken] = await db.select({ id: expenseCategoryTemplates.id })
      .from(expenseCategoryTemplates)
      .where(eq(expenseCategoryTemplates.name, data.name))
      .limit(1);
    if (nameTaken && nameTaken.id !== id) throw new AppError(MSG.NAME_IN_USE, 409);
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
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

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
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);
  if (existing.isActive) throw new AppError(MSG.ALREADY_ACTIVE, 409);

  const [updated] = await db.update(expenseCategoryTemplates)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(expenseCategoryTemplates.id, id))
    .returning();
  return updated;
}
