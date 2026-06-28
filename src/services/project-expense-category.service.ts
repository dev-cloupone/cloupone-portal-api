import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db';
import { projectExpenseCategories, expenseCategoryTemplates } from '../db/schema';
import { appError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: { message: 'Categoria de despesa do projeto não encontrada.', code: 'PROJECT_EXPENSE_CATEGORY_NOT_FOUND' },
  TEMPLATE_NOT_FOUND: { message: 'Template de categoria não encontrado ou inativo.', code: 'PROJECT_EXPENSE_CATEGORY_TEMPLATE_NOT_FOUND' },
  ALREADY_IMPORTED: { message: 'Este template já foi importado neste projeto.', code: 'PROJECT_EXPENSE_CATEGORY_ALREADY_IMPORTED' },
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
  if (!template) throw appError(MSG.TEMPLATE_NOT_FOUND, 404);

  // Check not already imported (active)
  const [existingActive] = await db.select({ id: projectExpenseCategories.id })
    .from(projectExpenseCategories)
    .where(and(
      eq(projectExpenseCategories.projectId, projectId),
      eq(projectExpenseCategories.templateId, templateId),
      eq(projectExpenseCategories.isActive, true),
    ))
    .limit(1);
  if (existingActive) throw appError(MSG.ALREADY_IMPORTED, 409);

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
  if (!existing) throw appError(MSG.NOT_FOUND, 404);

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
  if (!existing) throw appError(MSG.NOT_FOUND, 404);

  const [updated] = await db.update(projectExpenseCategories)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(projectExpenseCategories.id, id), eq(projectExpenseCategories.projectId, projectId)))
    .returning();
  return updated;
}
