import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { expenseCategories } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: 'Categoria de despesa não encontrada.',
  NAME_IN_USE: 'Já existe uma categoria de despesa com este nome.',
} as const;

export async function listCategories(includeInactive?: boolean) {
  if (includeInactive) {
    return db.select()
      .from(expenseCategories)
      .orderBy(asc(expenseCategories.sortOrder));
  }
  return db.select()
    .from(expenseCategories)
    .where(eq(expenseCategories.isActive, true))
    .orderBy(asc(expenseCategories.sortOrder));
}

export async function getCategoryById(id: string) {
  const [category] = await db.select()
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))
    .limit(1);
  if (!category) throw new AppError(MSG.NOT_FOUND, 404);
  return category;
}

export async function createCategory(data: {
  name: string;
  description?: string;
  maxAmount?: string;
  requiresReceipt?: boolean;
  sortOrder?: number;
}) {
  const [existing] = await db.select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.name, data.name))
    .limit(1);
  if (existing) throw new AppError(MSG.NAME_IN_USE, 409);

  const [created] = await db.insert(expenseCategories).values(data).returning();
  return created;
}

export async function updateCategory(id: string, data: Partial<{
  name: string;
  description: string;
  maxAmount: string;
  requiresReceipt: boolean;
  sortOrder: number;
}>) {
  const [existing] = await db.select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

  if (data.name) {
    const [nameTaken] = await db.select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(eq(expenseCategories.name, data.name))
      .limit(1);
    if (nameTaken && nameTaken.id !== id) throw new AppError(MSG.NAME_IN_USE, 409);
  }

  const [updated] = await db.update(expenseCategories)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(expenseCategories.id, id))
    .returning();
  return updated;
}

export async function deactivateCategory(id: string) {
  const [existing] = await db.select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.id, id))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

  const [updated] = await db.update(expenseCategories)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(expenseCategories.id, id))
    .returning();
  return updated;
}
