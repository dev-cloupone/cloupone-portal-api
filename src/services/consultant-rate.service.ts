import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { consultantProjectRates, users } from '../db/schema';

export async function listByProject(projectId: string) {
  return db.select({
    id: consultantProjectRates.id,
    userId: consultantProjectRates.userId,
    projectId: consultantProjectRates.projectId,
    costRate: consultantProjectRates.costRate,
    billingRate: consultantProjectRates.billingRate,
    consultantName: users.name,
    createdAt: consultantProjectRates.createdAt,
    updatedAt: consultantProjectRates.updatedAt,
  })
    .from(consultantProjectRates)
    .innerJoin(users, eq(consultantProjectRates.userId, users.id))
    .where(eq(consultantProjectRates.projectId, projectId))
    .orderBy(users.name);
}

export async function upsert(projectId: string, userId: string, data: { costRate: string; billingRate: string }) {
  const [existing] = await db.select({ id: consultantProjectRates.id })
    .from(consultantProjectRates)
    .where(and(eq(consultantProjectRates.projectId, projectId), eq(consultantProjectRates.userId, userId)))
    .limit(1);

  const now = new Date();

  if (existing) {
    const [updated] = await db.update(consultantProjectRates)
      .set({
        costRate: data.costRate,
        billingRate: data.billingRate,
        updatedAt: now,
      })
      .where(eq(consultantProjectRates.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(consultantProjectRates)
    .values({
      projectId,
      userId,
      costRate: data.costRate,
      billingRate: data.billingRate,
    })
    .returning();
  return created;
}
