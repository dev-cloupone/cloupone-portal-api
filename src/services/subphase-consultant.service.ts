import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { subphaseConsultants, projectSubphases, projectPhases, projectAllocations, users } from '../db/schema';
import { appError } from '../utils/app-error';
import { assertUserHasProjectAccess } from '../utils/project-access';

const MSG = {
  SUBPHASE_NOT_FOUND: { message: 'Subfase não encontrada.', code: 'SUBPHASE_CONSULTANT_SUBPHASE_NOT_FOUND' },
  PHASE_NOT_FOUND: { message: 'Fase não encontrada.', code: 'SUBPHASE_CONSULTANT_PHASE_NOT_FOUND' },
  CONSULTANT_NOT_ALLOCATED: { message: 'Consultor não está alocado neste projeto.', code: 'SUBPHASE_CONSULTANT_NOT_ALLOCATED' },
  CONSULTANT_ALREADY_LINKED: { message: 'Consultor já está vinculado a esta subfase.', code: 'SUBPHASE_CONSULTANT_ALREADY_LINKED' },
  LINK_NOT_FOUND: { message: 'Vínculo não encontrado.', code: 'SUBPHASE_CONSULTANT_LINK_NOT_FOUND' },
} as const;

export async function listConsultants(subphaseId: string) {
  return db.select({
    id: subphaseConsultants.id,
    subphaseId: subphaseConsultants.subphaseId,
    userId: subphaseConsultants.userId,
    userName: users.name,
    userEmail: users.email,
    estimatedHours: subphaseConsultants.estimatedHours,
    createdAt: subphaseConsultants.createdAt,
  }).from(subphaseConsultants)
    .innerJoin(users, eq(subphaseConsultants.userId, users.id))
    .where(eq(subphaseConsultants.subphaseId, subphaseId));
}

export async function addConsultant(subphaseId: string, userId: string, estimatedHours?: number, requestUserId?: string, requestUserRole?: string) {
  const [subphase] = await db.select({
    id: projectSubphases.id,
    phaseId: projectSubphases.phaseId,
  }).from(projectSubphases).where(eq(projectSubphases.id, subphaseId)).limit(1);
  if (!subphase) throw appError(MSG.SUBPHASE_NOT_FOUND, 404);

  const [phase] = await db.select({ projectId: projectPhases.projectId })
    .from(projectPhases).where(eq(projectPhases.id, subphase.phaseId)).limit(1);
  if (!phase) throw appError(MSG.PHASE_NOT_FOUND, 404);

  // Validar acesso do usuário que faz a requisição ao projeto
  if (requestUserId && requestUserRole) {
    await assertUserHasProjectAccess(requestUserId, requestUserRole, phase.projectId);
  }

  const [allocation] = await db.select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(eq(projectAllocations.projectId, phase.projectId), eq(projectAllocations.userId, userId)))
    .limit(1);
  if (!allocation) throw appError(MSG.CONSULTANT_NOT_ALLOCATED, 400);

  const [existing] = await db.select({ id: subphaseConsultants.id })
    .from(subphaseConsultants)
    .where(and(eq(subphaseConsultants.subphaseId, subphaseId), eq(subphaseConsultants.userId, userId)))
    .limit(1);
  if (existing) throw appError(MSG.CONSULTANT_ALREADY_LINKED, 409);

  const [created] = await db.insert(subphaseConsultants).values({
    subphaseId,
    userId,
    estimatedHours: estimatedHours ? String(estimatedHours) : undefined,
  }).returning();

  return created;
}

export async function updateConsultantHours(subphaseId: string, userId: string, estimatedHours: number) {
  const [existing] = await db.select({ id: subphaseConsultants.id })
    .from(subphaseConsultants)
    .where(and(eq(subphaseConsultants.subphaseId, subphaseId), eq(subphaseConsultants.userId, userId)))
    .limit(1);
  if (!existing) throw appError(MSG.LINK_NOT_FOUND, 404);

  const [updated] = await db.update(subphaseConsultants)
    .set({ estimatedHours: String(estimatedHours), updatedAt: new Date() })
    .where(eq(subphaseConsultants.id, existing.id)).returning();
  return updated;
}

export async function removeConsultant(subphaseId: string, userId: string) {
  const [existing] = await db.select({ id: subphaseConsultants.id })
    .from(subphaseConsultants)
    .where(and(eq(subphaseConsultants.subphaseId, subphaseId), eq(subphaseConsultants.userId, userId)))
    .limit(1);
  if (!existing) throw appError(MSG.LINK_NOT_FOUND, 404);

  await db.delete(subphaseConsultants).where(eq(subphaseConsultants.id, existing.id));
  return { success: true };
}

export async function loadConsultants(phaseId: string, requestUserId?: string, requestUserRole?: string) {
  const [phase] = await db.select({ id: projectPhases.id, projectId: projectPhases.projectId })
    .from(projectPhases).where(eq(projectPhases.id, phaseId)).limit(1);
  if (!phase) throw appError(MSG.PHASE_NOT_FOUND, 404);

  if (requestUserId && requestUserRole) {
    await assertUserHasProjectAccess(requestUserId, requestUserRole, phase.projectId);
  }

  const allocations = await db.select({ userId: projectAllocations.userId })
    .from(projectAllocations)
    .where(eq(projectAllocations.projectId, phase.projectId));

  if (allocations.length === 0) return { loaded: 0 };

  const subphases = await db.select()
    .from(projectSubphases)
    .where(and(eq(projectSubphases.phaseId, phaseId), eq(projectSubphases.isActive, true)));

  let totalLoaded = 0;

  for (const sp of subphases) {
    const hoursPerConsultant = allocations.length > 0 && sp.estimatedHours
      ? Number(sp.estimatedHours) / allocations.length
      : undefined;

    await db.delete(subphaseConsultants).where(eq(subphaseConsultants.subphaseId, sp.id));

    for (const alloc of allocations) {
      await db.insert(subphaseConsultants).values({
        subphaseId: sp.id,
        userId: alloc.userId,
        estimatedHours: hoursPerConsultant ? String(hoursPerConsultant) : undefined,
      });
      totalLoaded++;
    }
  }

  return { loaded: totalLoaded };
}
