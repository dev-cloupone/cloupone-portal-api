import { eq, and, asc, sum, sql, count as drizzleCount } from 'drizzle-orm';
import { db } from '../db';
import { projectPhases, projectSubphases, timeEntries, projects } from '../db/schema';
import type { SQL } from 'drizzle-orm';
import { AppError } from '../utils/app-error';

const MSG = {
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
  PHASE_NOT_FOUND: 'Fase não encontrada.',
} as const;

export async function listPhases(projectId: string) {
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  const phases = await db.select()
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, projectId), eq(projectPhases.isActive, true)))
    .orderBy(asc(projectPhases.order));

  const result = await Promise.all(phases.map(async (phase) => {
    const subphases = await db.select()
      .from(projectSubphases)
      .where(and(eq(projectSubphases.phaseId, phase.id), eq(projectSubphases.isActive, true)))
      .orderBy(asc(projectSubphases.order));

    let totalEstimatedHours = 0;
    let totalActualHours = 0;

    const enrichedSubphases = await Promise.all(subphases.map(async (sp) => {
      const estimated = Number(sp.estimatedHours || 0);
      totalEstimatedHours += estimated;

      const [hoursResult] = await db.select({
        total: sum(timeEntries.hours),
      }).from(timeEntries)
        .where(eq(timeEntries.subphaseId, sp.id));
      const actualHours = Number(hoursResult?.total || 0);
      totalActualHours += actualHours;

      return { ...sp, actualHours };
    }));

    return {
      ...phase,
      estimatedHours: totalEstimatedHours,
      actualHours: totalActualHours,
      subphaseCount: subphases.length,
      subphases: enrichedSubphases,
    };
  }));

  return result;
}

export async function createPhase(projectId: string, data: {
  name: string;
  description?: string;
}) {
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(${projectPhases.order}), -1)` })
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, projectId), eq(projectPhases.isActive, true)));

  const [created] = await db.insert(projectPhases).values({
    projectId,
    name: data.name,
    description: data.description,
    order: (maxOrder?.max ?? -1) + 1,
  }).returning();

  return created;
}

export async function updatePhase(phaseId: string, data: Partial<{
  name: string;
  description: string;
  order: number;
}>) {
  const [existing] = await db.select({ id: projectPhases.id })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!existing) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.order !== undefined) updateData.order = data.order;

  const [updated] = await db.update(projectPhases)
    .set(updateData).where(eq(projectPhases.id, phaseId)).returning();
  return updated;
}

export async function deactivatePhase(phaseId: string) {
  const [existing] = await db.select({ id: projectPhases.id })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!existing) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  const [updated] = await db.update(projectPhases)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(projectPhases.id, phaseId)).returning();
  return updated;
}

export async function reorderPhases(projectId: string, orderedIds: string[]) {
  await Promise.all(orderedIds.map((id, index) =>
    db.update(projectPhases)
      .set({ order: index, updatedAt: new Date() })
      .where(eq(projectPhases.id, id))
  ));
  return { success: true };
}

export async function getPhasesDashboard() {
  const today = new Date().toISOString().split('T')[0];

  // 1. Subfases in_progress with >80% hours consumed
  const allInProgress = await db.select()
    .from(projectSubphases)
    .innerJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
    .innerJoin(projects, eq(projectPhases.projectId, projects.id))
    .where(and(
      eq(projectSubphases.status, 'in_progress'),
      eq(projectSubphases.isActive, true),
      eq(projectPhases.isActive, true),
    ));

  const alertSubphases = [];
  const overdueSubphases = [];

  for (const row of allInProgress) {
    const estimated = Number(row.project_subphases.estimatedHours || 0);
    const [hoursResult] = await db.select({ total: sum(timeEntries.hours) })
      .from(timeEntries)
      .where(eq(timeEntries.subphaseId, row.project_subphases.id));
    const actual = Number(hoursResult?.total || 0);
    const percentage = estimated > 0 ? (actual / estimated) * 100 : 0;

    const item = {
      subphaseId: row.project_subphases.id,
      subphaseName: row.project_subphases.name,
      phaseName: row.project_phases.name,
      projectName: row.projects.name,
      estimatedHours: estimated,
      actualHours: actual,
      percentage,
      endDate: row.project_subphases.endDate,
    };

    if (percentage > 80) alertSubphases.push(item);
    if (row.project_subphases.endDate && row.project_subphases.endDate < today) {
      overdueSubphases.push(item);
    }
  }

  // 3. Summary per project
  const projectSummaries = await db.select({
    projectId: projectPhases.projectId,
    projectName: projects.name,
    totalPhases: drizzleCount(sql`DISTINCT ${projectPhases.id}`),
  })
    .from(projectPhases)
    .innerJoin(projects, eq(projectPhases.projectId, projects.id))
    .where(eq(projectPhases.isActive, true))
    .groupBy(projectPhases.projectId, projects.name);

  const summaries = await Promise.all(projectSummaries.map(async (ps) => {
    const statusCounts = await db.select({
      status: projectSubphases.status,
      count: drizzleCount(),
    })
      .from(projectSubphases)
      .innerJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
      .where(and(
        eq(projectPhases.projectId, ps.projectId),
        eq(projectSubphases.isActive, true),
        eq(projectPhases.isActive, true),
      ))
      .groupBy(projectSubphases.status);

    const byStatus: Record<string, number> = { planned: 0, in_progress: 0, completed: 0 };
    for (const sc of statusCounts) byStatus[sc.status] = sc.count;

    return {
      projectId: ps.projectId,
      projectName: ps.projectName,
      totalPhases: ps.totalPhases,
      subphases: byStatus,
    };
  }));

  return {
    alertSubphases: alertSubphases.sort((a, b) => b.percentage - a.percentage),
    overdueSubphases,
    projectSummaries: summaries,
  };
}
