import { eq } from 'drizzle-orm';
import { db } from '../db';
import { bankAccounts } from '../db/schema';
import { AppError } from '../utils/app-error';

export async function list(includeInactive = false) {
  if (includeInactive) {
    return db.query.bankAccounts.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  }
  return db.query.bankAccounts.findMany({
    where: eq(bankAccounts.isActive, true),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export async function listActive() {
  return db.query.bankAccounts.findMany({
    where: eq(bankAccounts.isActive, true),
    columns: { id: true, label: true },
    orderBy: (t, { asc }) => [asc(t.label)],
  });
}

export async function getById(id: string) {
  const result = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.id, id),
  });
  if (!result) throw new AppError('Conta bancaria nao encontrada', 404);
  return result;
}

export async function create(data: {
  label: string;
  holderName: string;
  bankName: string;
  agency: string;
  accountNumber: string;
  accountType: 'corrente' | 'poupanca';
  pixKey?: string;
}, userId: string) {
  const [created] = await db.insert(bankAccounts)
    .values({ ...data, updatedBy: userId })
    .returning();
  return created;
}

export async function update(id: string, data: {
  label?: string;
  holderName?: string;
  bankName?: string;
  agency?: string;
  accountNumber?: string;
  accountType?: 'corrente' | 'poupanca';
  pixKey?: string;
}, userId: string) {
  const existing = await getById(id);
  const [updated] = await db.update(bankAccounts)
    .set({ ...data, updatedAt: new Date(), updatedBy: userId })
    .where(eq(bankAccounts.id, existing.id))
    .returning();
  return updated;
}

export async function toggleActive(id: string, userId: string) {
  const existing = await getById(id);
  const [updated] = await db.update(bankAccounts)
    .set({ isActive: !existing.isActive, updatedAt: new Date(), updatedBy: userId })
    .where(eq(bankAccounts.id, id))
    .returning();
  return updated;
}
