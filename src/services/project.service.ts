import { eq, and, count as drizzleCount, desc, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projects, clients, projectAllocations, users } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const PROJECT = {
  NOT_FOUND: 'Projeto não encontrado.',
  CLIENT_NOT_FOUND: 'Cliente não encontrado.',
  ALLOCATION_EXISTS: 'Consultor já está alocado neste projeto.',
  ALLOCATION_NOT_FOUND: 'Alocação não encontrada.',
} as const;

export async function listProjects(params: PaginationParams & {
  clientId?: string;
  status?: string;
  userId?: string;
  userRole?: string;
}) {
  const { page, limit, clientId, status, userId, userRole } = params;
  const offset = (page - 1) * limit;

  const conditions = [eq(projects.isActive, true)];
  if (clientId) conditions.push(eq(projects.clientId, clientId));
  if (status) conditions.push(eq(projects.status, status as 'active' | 'paused' | 'finished'));

  const where = and(...conditions);

  // Gestor e consultor veem apenas projetos alocados
  if ((userRole === 'gestor' || userRole === 'consultor') && userId) {
    const allocations = await db.select({ projectId: projectAllocations.projectId })
      .from(projectAllocations)
      .where(eq(projectAllocations.userId, userId));

    if (allocations.length === 0) return { data: [], meta: buildMeta(0, { page, limit }) };

    const allocatedIds = allocations.map(a => a.projectId);
    const gestorWhere = and(...conditions, inArray(projects.id, allocatedIds));

    const [data, [{ total }]] = await Promise.all([
      db.select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        clientId: projects.clientId,
        clientName: clients.companyName,
        status: projects.status,
        billingRate: projects.billingRate,
        budgetHours: projects.budgetHours,
        budgetType: projects.budgetType,
        startDate: projects.startDate,
        endDate: projects.endDate,
        isActive: projects.isActive,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(gestorWhere)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: drizzleCount() }).from(projects).where(gestorWhere),
    ]);

    return { data, meta: buildMeta(total, { page, limit }) };
  }

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      clientId: projects.clientId,
      clientName: clients.companyName,
      status: projects.status,
      billingRate: projects.billingRate,
      budgetHours: projects.budgetHours,
      budgetType: projects.budgetType,
      startDate: projects.startDate,
      endDate: projects.endDate,
      isActive: projects.isActive,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(where)
      .orderBy(desc(projects.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(projects).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getProjectById(id: string) {
  const [project] = await db.select({
    id: projects.id,
    name: projects.name,
    description: projects.description,
    clientId: projects.clientId,
    clientName: clients.companyName,
    status: projects.status,
    billingRate: projects.billingRate,
    budgetHours: projects.budgetHours,
    budgetType: projects.budgetType,
    startDate: projects.startDate,
    endDate: projects.endDate,
    isActive: projects.isActive,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
  })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!project) throw new AppError(PROJECT.NOT_FOUND, 404);
  return project;
}

export async function createProject(data: {
  name: string;
  description?: string;
  clientId: string;
  billingRate: number;
  budgetHours?: number;
  budgetType?: string;
  startDate?: string;
  endDate?: string;
}) {
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, data.clientId)).limit(1);
  if (!client) throw new AppError(PROJECT.CLIENT_NOT_FOUND, 404);

  const { startDate, endDate, ...rest } = data;
  const [created] = await db.insert(projects).values({
    ...rest,
    billingRate: String(data.billingRate),
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  }).returning();
  return created;
}

export async function updateProject(id: string, data: Partial<{
  name: string;
  description: string;
  clientId: string;
  status: 'active' | 'paused' | 'finished';
  billingRate: number;
  budgetHours: number;
  budgetType: string;
  startDate: string;
  endDate: string;
}>) {
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) throw new AppError(PROJECT.NOT_FOUND, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.billingRate !== undefined) updateData.billingRate = String(data.billingRate);
  if (data.budgetHours !== undefined) updateData.budgetHours = data.budgetHours;
  if (data.budgetType !== undefined) updateData.budgetType = data.budgetType;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

  const [updated] = await db.update(projects).set(updateData).where(eq(projects.id, id)).returning();
  return updated;
}

export async function deactivateProject(id: string) {
  const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).limit(1);
  if (!existing) throw new AppError(PROJECT.NOT_FOUND, 404);

  const [updated] = await db.update(projects).set({ isActive: false, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
  return updated;
}

export async function listAllocations(projectId: string) {
  return db.select({
    id: projectAllocations.id,
    projectId: projectAllocations.projectId,
    userId: projectAllocations.userId,
    userName: users.name,
    userEmail: users.email,
    createdAt: projectAllocations.createdAt,
  })
    .from(projectAllocations)
    .innerJoin(users, eq(projectAllocations.userId, users.id))
    .where(eq(projectAllocations.projectId, projectId));
}

export async function addAllocation(projectId: string, userId: string) {
  const [existing] = await db.select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.userId, userId)))
    .limit(1);

  if (existing) throw new AppError(PROJECT.ALLOCATION_EXISTS, 409);

  const [created] = await db.insert(projectAllocations).values({ projectId, userId }).returning();
  return created;
}

export async function removeAllocation(projectId: string, userId: string) {
  const [existing] = await db.select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.userId, userId)))
    .limit(1);

  if (!existing) throw new AppError(PROJECT.ALLOCATION_NOT_FOUND, 404);

  await db.delete(projectAllocations)
    .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.userId, userId)));

  return { success: true };
}
