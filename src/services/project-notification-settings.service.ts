import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { projectNotificationSettings, projectNotificationEmails, projectAllocations, users } from '../db/schema';
import { appError } from '../utils/app-error';

const NOTIFICATION_SETTINGS = {
  EMAIL_ALREADY_EXISTS: {
    message: 'Este email já está cadastrado para este evento.',
    code: 'NOTIFICATION_EMAIL_ALREADY_EXISTS',
  },
  EMAIL_NOT_FOUND: {
    message: 'Email de notificação não encontrado.',
    code: 'NOTIFICATION_EMAIL_NOT_FOUND',
  },
  INVALID_USER_IDS: {
    message: 'Um ou mais usuários não estão alocados ao projeto.',
    code: 'INVALID_USER_IDS',
  },
} as const;

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
    throw appError(NOTIFICATION_SETTINGS.INVALID_USER_IDS, 400);
  }

  // Separate: remove entries where both channels are false, upsert the rest
  const toRemove = settings.filter(s => !s.channelEmail && !s.channelInApp);
  const toUpsert = settings.filter(s => s.channelEmail || s.channelInApp);

  await db.transaction(async (tx) => {
    // Agrupa os deletes por eventType para usar inArray em vez de 1 query por usuario.
    const byEvent = new Map<string, string[]>();
    for (const s of toRemove) {
      byEvent.set(s.eventType, [...(byEvent.get(s.eventType) ?? []), s.userId]);
    }
    for (const [eventType, ids] of byEvent) {
      await tx.delete(projectNotificationSettings).where(and(
        eq(projectNotificationSettings.projectId, projectId),
        eq(projectNotificationSettings.eventType, eventType),
        inArray(projectNotificationSettings.userId, ids),
      ));
    }

    if (toUpsert.length > 0) {
      // Insert unico: o `set` precisa usar excluded.* — repetir o valor de um
      // item aplicaria aquele valor a todas as linhas em conflito.
      await tx.insert(projectNotificationSettings)
        .values(toUpsert.map(s => ({
          projectId,
          userId: s.userId,
          eventType: s.eventType,
          channelEmail: s.channelEmail,
          channelInApp: s.channelInApp,
        })))
        .onConflictDoUpdate({
          target: [
            projectNotificationSettings.projectId,
            projectNotificationSettings.userId,
            projectNotificationSettings.eventType,
          ],
          set: {
            channelEmail: sql`excluded.channel_email`,
            channelInApp: sql`excluded.channel_in_app`,
            updatedAt: new Date(),
          },
        });
    }
  });
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
  // onConflictDoNothing evita depender de parsing do codigo 23505 do driver.
  const [created] = await db.insert(projectNotificationEmails)
    .values({ projectId, email, eventType })
    .onConflictDoNothing({
      target: [
        projectNotificationEmails.projectId,
        projectNotificationEmails.email,
        projectNotificationEmails.eventType,
      ],
    })
    .returning();

  if (!created) throw appError(NOTIFICATION_SETTINGS.EMAIL_ALREADY_EXISTS, 409);
  return created;
}

export async function removeEmail(projectId: string, id: string) {
  const [deleted] = await db.delete(projectNotificationEmails)
    .where(and(
      eq(projectNotificationEmails.id, id),
      eq(projectNotificationEmails.projectId, projectId),
    ))
    .returning({ id: projectNotificationEmails.id });

  if (!deleted) throw appError(NOTIFICATION_SETTINGS.EMAIL_NOT_FOUND, 404);
}
