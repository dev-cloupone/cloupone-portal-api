import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { activityCategories } from '../db/schema';
import { AppError } from '../utils/app-error';

const CATEGORY = {
  NOT_FOUND: 'Categoria não encontrada.',
  NAME_IN_USE: 'Já existe uma categoria com este nome.',
} as const;

export async function listCategories() {
  return db.select()
    .from(activityCategories)
    .where(eq(activityCategories.isActive, true))
    .orderBy(asc(activityCategories.sortOrder));
}

export async function createCategory(data: {
  name: string;
  description?: string;
  isBillable?: boolean;
  sortOrder?: number;
}) {
  const [existing] = await db.select({ id: activityCategories.id })
    .from(activityCategories)
    .where(eq(activityCategories.name, data.name))
    .limit(1);
  if (existing) throw new AppError(CATEGORY.NAME_IN_USE, 409);

  const [created] = await db.insert(activityCategories).values(data).returning();
  return created;
}

export async function updateCategory(id: string, data: Partial<{
  name: string;
  description: string;
  isBillable: boolean;
  sortOrder: number;
}>) {
  const [existing] = await db.select({ id: activityCategories.id })
    .from(activityCategories)
    .where(eq(activityCategories.id, id))
    .limit(1);
  if (!existing) throw new AppError(CATEGORY.NOT_FOUND, 404);

  if (data.name) {
    const [nameTaken] = await db.select({ id: activityCategories.id })
      .from(activityCategories)
      .where(eq(activityCategories.name, data.name))
      .limit(1);
    if (nameTaken && nameTaken.id !== id) throw new AppError(CATEGORY.NAME_IN_USE, 409);
  }

  const [updated] = await db.update(activityCategories)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(activityCategories.id, id))
    .returning();
  return updated;
}

export async function deactivateCategory(id: string) {
  const [existing] = await db.select({ id: activityCategories.id })
    .from(activityCategories)
    .where(eq(activityCategories.id, id))
    .limit(1);
  if (!existing) throw new AppError(CATEGORY.NOT_FOUND, 404);

  const [updated] = await db.update(activityCategories)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(activityCategories.id, id))
    .returning();
  return updated;
}
