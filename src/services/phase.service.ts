import { eq, and, asc, sum, sql, count as drizzleCount, ne, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projectPhases, projectSubphases, timeEntries, projects, projectAllocations } from '../db/schema';
import { clients } from '../db/schema/clients';
import type { SQL } from 'drizzle-orm';
import { AppError } from '../utils/app-error';
import { assertUserHasProjectAccess } from '../utils/project-access';

const MSG = {
  PROJECT_NOT_FOUND: 'Projeto não encontrado.',
  PHASE_NOT_FOUND: 'Fase não encontrada.',
  TARGET_HAS_PHASES: 'O projeto destino já possui fases ativas.',
  SOURCE_ACCESS_DENIED: 'Você não tem acesso ao projeto de origem.',
  INVALID_PHASE_IDS: 'Uma ou mais fases selecionadas não pertencem ao projeto de origem.',
  INVALID_SUBPHASE_IDS: 'Uma ou mais subfases selecionadas não pertencem às fases informadas.',
} as const;

export async function listPhases(projectId: string, userId?: string, userRole?: string) {
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  if (userId && userRole) {
    await assertUserHasProjectAccess(userId, userRole, projectId);
  }

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
}, userId?: string, userRole?: string) {
  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  if (userId && userRole) {
    await assertUserHasProjectAccess(userId, userRole, projectId);
  }

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
}>, userId?: string, userRole?: string) {
  const [existing] = await db.select({ id: projectPhases.id, projectId: projectPhases.projectId })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!existing) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  if (userId && userRole) {
    await assertUserHasProjectAccess(userId, userRole, existing.projectId);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.order !== undefined) updateData.order = data.order;

  const [updated] = await db.update(projectPhases)
    .set(updateData).where(eq(projectPhases.id, phaseId)).returning();
  return updated;
}

export async function deactivatePhase(phaseId: string, userId?: string, userRole?: string) {
  const [existing] = await db.select({ id: projectPhases.id, projectId: projectPhases.projectId })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!existing) throw new AppError(MSG.PHASE_NOT_FOUND, 404);

  if (userId && userRole) {
    await assertUserHasProjectAccess(userId, userRole, existing.projectId);
  }

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

// --- Clone de Fases ---

export async function listClonableProjects(targetProjectId: string, userId: string, userRole: string) {
  // Base query: projetos ativos com fases ativas, excluindo o projeto destino
  let projectRows;

  if (userRole === 'super_admin') {
    projectRows = await db.select({
      id: projects.id,
      name: projects.name,
      clientName: clients.companyName,
    })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(and(
        eq(projects.isActive, true),
        ne(projects.id, targetProjectId),
      ));
  } else {
    // Gestor: apenas projetos em que está alocado
    projectRows = await db.select({
      id: projects.id,
      name: projects.name,
      clientName: clients.companyName,
    })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(projectAllocations, and(
        eq(projectAllocations.projectId, projects.id),
        eq(projectAllocations.userId, userId),
      ))
      .where(and(
        eq(projects.isActive, true),
        ne(projects.id, targetProjectId),
      ));
  }

  // Filtrar apenas projetos que têm fases ativas e enriquecer com fases + subfases
  const result = [];
  for (const proj of projectRows) {
    const phases = await db.select({
      id: projectPhases.id,
      name: projectPhases.name,
    })
      .from(projectPhases)
      .where(and(eq(projectPhases.projectId, proj.id), eq(projectPhases.isActive, true)))
      .orderBy(asc(projectPhases.order));

    if (phases.length === 0) continue;

    const phasesWithSubphases = await Promise.all(phases.map(async (phase) => {
      const subphases = await db.select({
        id: projectSubphases.id,
        name: projectSubphases.name,
        estimatedHours: projectSubphases.estimatedHours,
      })
        .from(projectSubphases)
        .where(and(eq(projectSubphases.phaseId, phase.id), eq(projectSubphases.isActive, true)))
        .orderBy(asc(projectSubphases.order));

      return {
        ...phase,
        subphases: subphases.map(sp => ({
          ...sp,
          estimatedHours: sp.estimatedHours ? Number(sp.estimatedHours) : null,
        })),
      };
    }));

    result.push({
      id: proj.id,
      name: proj.name,
      clientName: proj.clientName,
      phases: phasesWithSubphases,
    });
  }

  return result;
}

export async function clonePhases(
  targetProjectId: string,
  sourceProjectId: string,
  phases: Array<{ phaseId: string; subphaseIds: string[] }>,
  userId: string,
  userRole: string,
) {
  // 1. Validar que o projeto destino existe
  const [targetProject] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.id, targetProjectId)).limit(1);
  if (!targetProject) throw new AppError(MSG.PROJECT_NOT_FOUND, 404);

  // 2. Validar que o projeto destino não tem fases ativas
  const existingPhases = await db.select({ id: projectPhases.id })
    .from(projectPhases)
    .where(and(eq(projectPhases.projectId, targetProjectId), eq(projectPhases.isActive, true)))
    .limit(1);
  if (existingPhases.length > 0) throw new AppError(MSG.TARGET_HAS_PHASES, 400);

  // 3. Validar acesso do gestor ao projeto de origem
  if (userRole !== 'super_admin') {
    const [allocation] = await db.select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(
        eq(projectAllocations.projectId, sourceProjectId),
        eq(projectAllocations.userId, userId),
      ))
      .limit(1);
    if (!allocation) throw new AppError(MSG.SOURCE_ACCESS_DENIED, 403);
  }

  // 4. Validar que os phaseIds existem no projeto de origem
  const sourcePhaseIds = phases.map(p => p.phaseId);
  const sourcePhases = await db.select()
    .from(projectPhases)
    .where(and(
      eq(projectPhases.projectId, sourceProjectId),
      eq(projectPhases.isActive, true),
      inArray(projectPhases.id, sourcePhaseIds),
    ))
    .orderBy(asc(projectPhases.order));

  if (sourcePhases.length !== sourcePhaseIds.length) {
    throw new AppError(MSG.INVALID_PHASE_IDS, 400);
  }

  // 5. Validar que os subphaseIds existem nas fases correspondentes
  for (const p of phases) {
    const sourceSubphases = await db.select({ id: projectSubphases.id })
      .from(projectSubphases)
      .where(and(
        eq(projectSubphases.phaseId, p.phaseId),
        eq(projectSubphases.isActive, true),
        inArray(projectSubphases.id, p.subphaseIds),
      ));
    if (sourceSubphases.length !== p.subphaseIds.length) {
      throw new AppError(MSG.INVALID_SUBPHASE_IDS, 400);
    }
  }

  // 6. Executar clone em transação
  return db.transaction(async (tx) => {
    const createdPhases = [];
    let phaseOrder = 0;

    for (const p of phases) {
      const sourcePhase = sourcePhases.find(sp => sp.id === p.phaseId)!;

      const [newPhase] = await tx.insert(projectPhases).values({
        projectId: targetProjectId,
        name: sourcePhase.name,
        description: sourcePhase.description,
        order: phaseOrder++,
      }).returning();

      // Buscar subfases de origem na ordem correta
      const sourceSubphases = await tx.select()
        .from(projectSubphases)
        .where(and(
          eq(projectSubphases.phaseId, p.phaseId),
          eq(projectSubphases.isActive, true),
          inArray(projectSubphases.id, p.subphaseIds),
        ))
        .orderBy(asc(projectSubphases.order));

      let subOrder = 0;
      const createdSubphases = [];
      for (const sp of sourceSubphases) {
        const [newSp] = await tx.insert(projectSubphases).values({
          phaseId: newPhase.id,
          name: sp.name,
          description: sp.description,
          estimatedHours: sp.estimatedHours,
          order: subOrder++,
          // status defaults to 'planned', sem datas, sem consultores
        }).returning();
        createdSubphases.push(newSp);
      }

      createdPhases.push({ ...newPhase, subphases: createdSubphases });
    }

    return createdPhases;
  });
}
