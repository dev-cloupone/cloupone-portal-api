import { eq, desc, lt } from 'drizzle-orm';
import { db } from '../db';
import { loginHistory } from '../db/schema';
import { getSetting } from './platform-settings.service';

export async function recordAttempt(params: {
  userId: string | null;
  success: boolean;
  ipAddress: string;
  userAgent: string;
}): Promise<void> {
  await db.insert(loginHistory).values({
    userId: params.userId,
    success: params.success,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function getByUserId(userId: string, limit = 50) {
  return db.select()
    .from(loginHistory)
    .where(eq(loginHistory.userId, userId))
    .orderBy(desc(loginHistory.createdAt))
    .limit(limit);
}

export async function purgeOldEntries(): Promise<number> {
  const retentionDays = parseInt(await getSetting('login_history_retention_days') || '90', 10);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const deleted = await db.delete(loginHistory)
    .where(lt(loginHistory.createdAt, cutoffDate))
    .returning({ id: loginHistory.id });

  return deleted.length;
}
