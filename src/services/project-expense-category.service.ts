import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { projectExpenseCategories, expenseCategoryTemplates } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: 'Categoria de despesa do projeto não encontrada.',
  TEMPLATE_NOT_FOUND: 'Template de categoria não encontrado ou inativo.',
  ALREADY_IMPORTED: 'Este template já foi importado neste projeto.',
} as const;

export async function listByProject(projectId: string) {
  return db.select()
    .from(projectExpenseCategories)
    .where(and(
      eq(projectExpenseCategories.projectId, projectId),
      eq(projectExpenseCategories.isActive, true),
    ))
    .orderBy(asc(projectExpenseCategories.name));
}

export async function importFromTemplate(
  projectId: string,
  templateId: string,
  overrides: { maxAmount?: string | null; kmRate?: string | null },
) {
  // Validate template exists and is active
  const [template] = await db.select()
    .from(expenseCategoryTemplates)
    .where(and(
      eq(expenseCategoryTemplates.id, templateId),
      eq(expenseCategoryTemplates.isActive, true),
    ))
    .limit(1);
  if (!template) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404);

  // Check not already imported (active)
  const [existingActive] = await db.select({ id: projectExpenseCategories.id })
    .from(projectExpenseCategories)
    .where(and(
      eq(projectExpenseCategories.projectId, projectId),
      eq(projectExpenseCategories.templateId, templateId),
      eq(projectExpenseCategories.isActive, true),
    ))
    .limit(1);
  if (existingActive) throw new AppError(MSG.ALREADY_IMPORTED, 409);

  // Check for deactivated category with same template — reactivate it
  const [existingInactive] = await db.select({ id: projectExpenseCategories.id })
    .from(projectExpenseCategories)
    .where(and(
      eq(projectExpenseCategories.projectId, projectId),
      eq(projectExpenseCategories.templateId, templateId),
      eq(projectExpenseCategories.isActive, false),
    ))
    .limit(1);

  if (existingInactive) {
    const [reactivated] = await db.update(projectExpenseCategories)
      .set({
        isActive: true,
        name: template.name,
        maxAmount: overrides.maxAmount ?? template.defaultMaxAmount ?? null,
        kmRate: overrides.kmRate ?? template.defaultKmRate ?? null,
        requiresReceipt: template.requiresReceipt,
        isKmCategory: template.isKmCategory,
        updatedAt: new Date(),
      })
      .where(eq(projectExpenseCategories.id, existingInactive.id))
      .returning();
    return reactivated;
  }

  const [created] = await db.insert(projectExpenseCategories).values({
    projectId,
    templateId,
    name: template.name,
    maxAmount: overrides.maxAmount ?? template.defaultMaxAmount ?? null,
    kmRate: overrides.kmRate ?? template.defaultKmRate ?? null,
    requiresReceipt: template.requiresReceipt,
    isKmCategory: template.isKmCategory,
  }).returning();

  return created;
}

export async function updateProjectCategory(
  id: string,
  projectId: string,
  data: Partial<{
    maxAmount: string | null;
    kmRate: string | null;
    isActive: boolean;
  }>,
) {
  const [existing] = await db.select({ id: projectExpenseCategories.id })
    .from(projectExpenseCategories)
    .where(and(eq(projectExpenseCategories.id, id), eq(projectExpenseCategories.projectId, projectId)))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

  const [updated] = await db.update(projectExpenseCategories)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(projectExpenseCategories.id, id), eq(projectExpenseCategories.projectId, projectId)))
    .returning();
  return updated;
}

export async function deactivateProjectCategory(id: string, projectId: string) {
  const [existing] = await db.select({ id: projectExpenseCategories.id })
    .from(projectExpenseCategories)
    .where(and(eq(projectExpenseCategories.id, id), eq(projectExpenseCategories.projectId, projectId)))
    .limit(1);
  if (!existing) throw new AppError(MSG.NOT_FOUND, 404);

  const [updated] = await db.update(projectExpenseCategories)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(projectExpenseCategories.id, id), eq(projectExpenseCategories.projectId, projectId)))
    .returning();
  return updated;
}
