import { eq, and, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import { consultantProfiles, users, projectAllocations, projects, clients } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const CONSULTANT = {
  NOT_FOUND: 'Perfil de consultor não encontrado.',
  USER_NOT_FOUND: 'Usuário não encontrado.',
  ALREADY_EXISTS: 'Este usuário já possui perfil de consultor.',
} as const;

export async function listConsultants(params: PaginationParams) {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: consultantProfiles.id,
      userId: consultantProfiles.userId,
      userName: users.name,
      userEmail: users.email,
      hourlyRate: consultantProfiles.hourlyRate,
      contractType: consultantProfiles.contractType,
      allowOverlappingEntries: consultantProfiles.allowOverlappingEntries,
      createdAt: consultantProfiles.createdAt,
      updatedAt: consultantProfiles.updatedAt,
    })
      .from(consultantProfiles)
      .innerJoin(users, eq(consultantProfiles.userId, users.id))
      .orderBy(desc(consultantProfiles.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(consultantProfiles),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getConsultantByUserId(userId: string) {
  const [profile] = await db.select({
    id: consultantProfiles.id,
    userId: consultantProfiles.userId,
    userName: users.name,
    userEmail: users.email,
    hourlyRate: consultantProfiles.hourlyRate,
    contractType: consultantProfiles.contractType,
    allowOverlappingEntries: consultantProfiles.allowOverlappingEntries,
    createdAt: consultantProfiles.createdAt,
    updatedAt: consultantProfiles.updatedAt,
  })
    .from(consultantProfiles)
    .innerJoin(users, eq(consultantProfiles.userId, users.id))
    .where(eq(consultantProfiles.userId, userId))
    .limit(1);

  if (!profile) throw new AppError(CONSULTANT.NOT_FOUND, 404);
  return profile;
}

export async function createConsultant(data: { userId: string; hourlyRate: number; contractType: string; allowOverlappingEntries?: boolean }) {
  const [user] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, data.userId)).limit(1);
  if (!user) throw new AppError(CONSULTANT.USER_NOT_FOUND, 404);

  const [existing] = await db.select({ id: consultantProfiles.id })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, data.userId))
    .limit(1);
  if (existing) throw new AppError(CONSULTANT.ALREADY_EXISTS, 409);

  return db.transaction(async (tx) => {
    const [profile] = await tx.insert(consultantProfiles).values({
      userId: data.userId,
      hourlyRate: String(data.hourlyRate),
      contractType: data.contractType as 'clt' | 'pj' | 'horista',
      allowOverlappingEntries: data.allowOverlappingEntries ?? false,
    }).returning();

    // Update role to 'consultor' if currently 'user'
    if (user.role === 'user') {
      await tx.update(users)
        .set({ role: 'consultor', updatedAt: new Date() })
        .where(eq(users.id, data.userId));
    }

    return profile;
  });
}

export async function updateConsultant(userId: string, data: Partial<{ hourlyRate: number; contractType: string; allowOverlappingEntries: boolean }>) {
  const [existing] = await db.select({ id: consultantProfiles.id })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, userId))
    .limit(1);
  if (!existing) throw new AppError(CONSULTANT.NOT_FOUND, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.hourlyRate !== undefined) updateData.hourlyRate = String(data.hourlyRate);
  if (data.contractType !== undefined) updateData.contractType = data.contractType;
  if (data.allowOverlappingEntries !== undefined) updateData.allowOverlappingEntries = data.allowOverlappingEntries;

  const [updated] = await db.update(consultantProfiles)
    .set(updateData)
    .where(eq(consultantProfiles.userId, userId))
    .returning();

  return updated;
}

export async function listConsultantProjects(userId: string) {
  return db.select({
    allocationId: projectAllocations.id,
    projectId: projects.id,
    projectName: projects.name,
    clientName: clients.companyName,
    status: projects.status,
    billingRate: projects.billingRate,
  })
    .from(projectAllocations)
    .innerJoin(projects, eq(projectAllocations.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(eq(projectAllocations.userId, userId), eq(projects.isActive, true)));
}
