import { eq, and, ilike, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import { clients } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const CLIENT = {
  NOT_FOUND: 'Cliente não encontrado.',
  CNPJ_IN_USE: 'Já existe um cliente com este CNPJ.',
} as const;

export async function listClients(params: PaginationParams & { search?: string }) {
  const { page, limit, search } = params;
  const offset = (page - 1) * limit;

  const conditions = [eq(clients.isActive, true)];
  if (search) conditions.push(ilike(clients.companyName, `%${search}%`));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db.select().from(clients).where(where).orderBy(desc(clients.createdAt)).limit(limit).offset(offset),
    db.select({ total: drizzleCount() }).from(clients).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getClientById(id: string) {
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client) throw new AppError(CLIENT.NOT_FOUND, 404);
  return client;
}

export async function createClient(data: {
  companyName: string;
  cnpj?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
}) {
  if (data.cnpj) {
    const [existing] = await db.select({ id: clients.id }).from(clients).where(eq(clients.cnpj, data.cnpj)).limit(1);
    if (existing) throw new AppError(CLIENT.CNPJ_IN_USE, 409);
  }

  const [created] = await db.insert(clients).values(data).returning();
  return created;
}

export async function updateClient(id: string, data: Partial<{
  companyName: string;
  cnpj: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
}>) {
  const [existing] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!existing) throw new AppError(CLIENT.NOT_FOUND, 404);

  if (data.cnpj) {
    const [cnpjTaken] = await db.select({ id: clients.id }).from(clients).where(eq(clients.cnpj, data.cnpj)).limit(1);
    if (cnpjTaken && cnpjTaken.id !== id) throw new AppError(CLIENT.CNPJ_IN_USE, 409);
  }

  const [updated] = await db.update(clients).set({ ...data, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
  return updated;
}

export async function deactivateClient(id: string) {
  const [existing] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, id)).limit(1);
  if (!existing) throw new AppError(CLIENT.NOT_FOUND, 404);

  const [updated] = await db.update(clients).set({ isActive: false, updatedAt: new Date() }).where(eq(clients.id, id)).returning();
  return updated;
}
