import { eq, and, desc, sql, count } from 'drizzle-orm';
import { db } from '../db';
import { notifications } from '../db/schema';
import { buildMeta } from '../utils/pagination';
import type { PaginationParams } from '../types/pagination.types';
import { sseManager } from './sse-manager';

export async function listByUser(userId: string, params: PaginationParams) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(eq(notifications.userId, userId));

  const data = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(params.limit)
    .offset((params.page - 1) * params.limit);

  return { data, meta: buildMeta(total, params) };
}

export async function getUnreadCount(userId: string) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ));

  return total;
}

export async function markAsRead(notificationId: string, userId: string) {
  const [updated] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.userId, userId),
    ))
    .returning();
  return updated;
}

export async function markAllAsRead(userId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false),
    ));
}

export async function create(data: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}) {
  const [notification] = await db
    .insert(notifications)
    .values(data)
    .returning();

  // Deliver via SSE in real-time
  sseManager.send(data.userId, notification);

  return notification;
}
