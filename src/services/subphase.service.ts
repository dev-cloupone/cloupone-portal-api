import { eq, and, asc, sum, sql } from 'drizzle-orm';
import { db } from '../db';
import { projectSubphases, projectPhases, subphaseConsultants, timeEntries, users } from '../db/schema';
import { AppError } from '../utils/app-error';
import { calculateEndDate } from '../utils/business-days';

const MSG = {
  PHASE_NOT_FOUND: 'Fase não encontrada.',
  SUBPHASE_NOT_FOUND: 'Subfase não encontrada.',
  INVALID_STATUS_TRANSITION: 'Transição de status inválida.',
} as const;

const VALID_TRANSITIONS: Record<string, string[]> = {
  planned: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};

export async function listSubphases(phaseId: string) {
  const [phase] = await db.select({ id: projectPhases.id })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!phase) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  const subphases = await db.select()
    .from(projectSubphases)
    .where(and(eq(projectSubphases.phaseId, phaseId), eq(projectSubphases.isActive, true)))
    .orderBy(asc(projectSubphases.order));

  return Promise.all(subphases.map(async (sp) => {
    const consultants = await db.select({
      id: subphaseConsultants.id,
      userId: subphaseConsultants.userId,
      userName: users.name,
      userEmail: users.email,
      estimatedHours: subphaseConsultants.estimatedHours,
    }).from(subphaseConsultants)
      .innerJoin(users, eq(subphaseConsultants.userId, users.id))
      .where(eq(subphaseConsultants.subphaseId, sp.id));

    const actualByConsultant = await db.select({
      userId: timeEntries.userId,
      total: sum(timeEntries.hours),
    }).from(timeEntries)
      .where(eq(timeEntries.subphaseId, sp.id))
      .groupBy(timeEntries.userId);

    const actualMap = new Map(actualByConsultant.map(a => [a.userId, Number(a.total || 0)]));

    const totalActualHours = actualByConsultant.reduce((acc, a) => acc + Number(a.total || 0), 0);

    return {
      ...sp,
      actualHours: totalActualHours,
      consultants: consultants.map(c => ({
        ...c,
        actualHours: actualMap.get(c.userId) || 0,
      })),
    };
  }));
}

export async function createSubphase(phaseId: string, data: {
  name: string;
  description?: string;
  estimatedHours?: number;
  startDate?: string;
  businessDays?: number;
}) {
  const [phase] = await db.select({ id: projectPhases.id })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!phase) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  let endDate: string | undefined;
  if (data.startDate && data.businessDays) {
    endDate = calculateEndDate(data.startDate, data.businessDays);
  }

  const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(${projectSubphases.order}), -1)` })
    .from(projectSubphases)
    .where(and(eq(projectSubphases.phaseId, phaseId), eq(projectSubphases.isActive, true)));

  const [created] = await db.insert(projectSubphases).values({
    phaseId,
    name: data.name,
    description: data.description,
    estimatedHours: data.estimatedHours ? String(data.estimatedHours) : undefined,
    startDate: data.startDate,
    businessDays: data.businessDays,
    endDate,
    order: (maxOrder?.max ?? -1) + 1,
  }).returning();

  return created;
}

export async function updateSubphase(subphaseId: string, data: Partial<{
  name: string;
  description: string;
  estimatedHours: number;
  startDate: string;
  businessDays: number;
  order: number;
}>) {
  const [existing] = await db.select()
    .from(projectSubphases).where(eq(projectSubphases.id, subphaseId)).limit(1);
  if (!existing) throw new AppError(MSG.SUBPHASE_NOT_FOUND, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.estimatedHours !== undefined) updateData.estimatedHours = String(data.estimatedHours);
  if (data.order !== undefined) updateData.order = data.order;

  const startDate = data.startDate ?? existing.startDate;
  const businessDays = data.businessDays ?? existing.businessDays;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.businessDays !== undefined) updateData.businessDays = data.businessDays;
  if (startDate && businessDays) {
    updateData.endDate = calculateEndDate(startDate, businessDays);
  }

  const [updated] = await db.update(projectSubphases)
    .set(updateData).where(eq(projectSubphases.id, subphaseId)).returning();
  return updated;
}

export async function updateSubphaseStatus(subphaseId: string, newStatus: string) {
  const [existing] = await db.select()
    .from(projectSubphases).where(eq(projectSubphases.id, subphaseId)).limit(1);
  if (!existing) throw new AppError(MSG.SUBPHASE_NOT_FOUND, 404);

  const allowedTransitions = VALID_TRANSITIONS[existing.status] || [];
  if (!allowedTransitions.includes(newStatus)) {
    throw new AppError(MSG.INVALID_STATUS_TRANSITION, 400);
  }

  const [updated] = await db.update(projectSubphases)
    .set({ status: newStatus as 'planned' | 'in_progress' | 'completed', updatedAt: new Date() })
    .where(eq(projectSubphases.id, subphaseId)).returning();
  return updated;
}

export async function deactivateSubphase(subphaseId: string) {
  const [existing] = await db.select({ id: projectSubphases.id })
    .from(projectSubphases).where(eq(projectSubphases.id, subphaseId)).limit(1);
  if (!existing) throw new AppError(MSG.SUBPHASE_NOT_FOUND, 404);

  const [updated] = await db.update(projectSubphases)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(projectSubphases.id, subphaseId)).returning();
  return updated;
}

export async function reorderSubphases(phaseId: string, orderedIds: string[]) {
  await Promise.all(orderedIds.map((id, index) =>
    db.update(projectSubphases)
      .set({ order: index, updatedAt: new Date() })
      .where(eq(projectSubphases.id, id))
  ));
  return { success: true };
}

export async function listAvailableForTimeEntry(projectId: string, userId: string) {
  const rows = await db.select({
    id: projectSubphases.id,
    name: projectSubphases.name,
    phaseId: projectSubphases.phaseId,
    phaseName: projectPhases.name,
    estimatedHours: projectSubphases.estimatedHours,
    consultantEstimatedHours: subphaseConsultants.estimatedHours,
  })
    .from(projectSubphases)
    .innerJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
    .innerJoin(subphaseConsultants, and(
      eq(subphaseConsultants.subphaseId, projectSubphases.id),
      eq(subphaseConsultants.userId, userId),
    ))
    .where(and(
      eq(projectPhases.projectId, projectId),
      eq(projectSubphases.status, 'in_progress'),
      eq(projectSubphases.isActive, true),
      eq(projectPhases.isActive, true),
    ))
    .orderBy(asc(projectPhases.order), asc(projectSubphases.order));

  return Promise.all(rows.map(async (row) => {
    const [result] = await db.select({ total: sum(timeEntries.hours) })
      .from(timeEntries)
      .where(and(eq(timeEntries.subphaseId, row.id), eq(timeEntries.userId, userId)));
    return {
      ...row,
      consultantActualHours: Number(result?.total || 0),
    };
  }));
}
