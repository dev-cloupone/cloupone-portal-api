import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projectNotificationSettings, projectNotificationEmails, projectAllocations, users } from '../db/schema';
import { appError } from '../utils/app-error';

export async function getSettings(projectId: string, eventType: string) {
  const allocatedUsers = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      channelEmail: projectNotificationSettings.channelEmail,
      channelInApp: projectNotificationSettings.channelInApp,
    })
    .from(projectAllocations)
    .innerJoin(users, eq(projectAllocations.userId, users.id))
    .leftJoin(projectNotificationSettings, and(
      eq(projectNotificationSettings.userId, users.id),
      eq(projectNotificationSettings.projectId, projectAllocations.projectId),
      eq(projectNotificationSettings.eventType, eventType),
    ))
    .where(eq(projectAllocations.projectId, projectId));

  return allocatedUsers.map(u => ({
    ...u,
    eventType,
    channelEmail: u.channelEmail ?? false,
    channelInApp: u.channelInApp ?? false,
  }));
}

export async function upsertSettings(
  projectId: string,
  settings: { userId: string; eventType: string; channelEmail: boolean; channelInApp: boolean }[],
) {
  if (settings.length === 0) return;

  // Validate all userIds are allocated to the project
  const userIds = [...new Set(settings.map(s => s.userId))];
  const allocated = await db
    .select({ userId: projectAllocations.userId })
    .from(projectAllocations)
    .where(and(
      eq(projectAllocations.projectId, projectId),
      inArray(projectAllocations.userId, userIds),
    ));

  const allocatedIds = new Set(allocated.map(a => a.userId));
  const invalid = userIds.filter(id => !allocatedIds.has(id));
  if (invalid.length > 0) {
    throw appError({ message: `Usuarios nao alocados ao projeto: ${invalid.join(', ')}`, code: 'INVALID_USER_IDS' }, 400);
  }

  // Separate: remove entries where both channels are false, upsert the rest
  const toRemove = settings.filter(s => !s.channelEmail && !s.channelInApp);
  const toUpsert = settings.filter(s => s.channelEmail || s.channelInApp);

  if (toRemove.length > 0) {
    for (const s of toRemove) {
      await db.delete(projectNotificationSettings)
        .where(and(
          eq(projectNotificationSettings.projectId, projectId),
          eq(projectNotificationSettings.userId, s.userId),
          eq(projectNotificationSettings.eventType, s.eventType),
        ));
    }
  }

  for (const s of toUpsert) {
    await db.insert(projectNotificationSettings)
      .values({
        projectId,
        userId: s.userId,
        eventType: s.eventType,
        channelEmail: s.channelEmail,
        channelInApp: s.channelInApp,
      })
      .onConflictDoUpdate({
        target: [projectNotificationSettings.projectId, projectNotificationSettings.userId, projectNotificationSettings.eventType],
        set: {
          channelEmail: s.channelEmail,
          channelInApp: s.channelInApp,
          updatedAt: new Date(),
        },
      });
  }
}

export async function getEmails(projectId: string) {
  return db
    .select({
      id: projectNotificationEmails.id,
      email: projectNotificationEmails.email,
      eventType: projectNotificationEmails.eventType,
      createdAt: projectNotificationEmails.createdAt,
    })
    .from(projectNotificationEmails)
    .where(eq(projectNotificationEmails.projectId, projectId));
}

export async function addEmail(projectId: string, email: string, eventType: string) {
  const [created] = await db.insert(projectNotificationEmails)
    .values({ projectId, email, eventType })
    .returning();
  return created;
}

export async function removeEmail(id: string) {
  await db.delete(projectNotificationEmails)
    .where(eq(projectNotificationEmails.id, id));
}
