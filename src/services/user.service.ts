import bcrypt from 'bcrypt';
import { eq, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { AppError } from '../utils/app-error';
import { USER } from '../utils/error-messages';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import { getSettingsMap } from './platform-settings.service';
import { getEmailProvider } from '../providers/email';
import { buildWelcomeEmail } from '../emails';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const SALT_ROUNDS = 12;

const safeFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  clientId: users.clientId,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

export async function getDashboard() {
  const [totalResult] = await db.select({ total: drizzleCount() }).from(users);
  const [activeResult] = await db.select({ total: drizzleCount() }).from(users).where(eq(users.isActive, true));
  const [superAdminsResult] = await db.select({ total: drizzleCount() }).from(users).where(
    eq(users.role, 'super_admin'),
  );

  const recentUsers = await db
    .select(safeFields)
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);

  return {
    totalUsers: totalResult.total,
    activeUsers: activeResult.total,
    totalSuperAdmins: superAdminsResult.total,
    recentUsers,
  };
}

export async function listUsers(pagination: PaginationParams) {
  const offset = (pagination.page - 1) * pagination.limit;

  const [data, [{ total }]] = await Promise.all([
    db.select(safeFields)
      .from(users)
      .orderBy(users.createdAt)
      .limit(pagination.limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(users),
  ]);

  return { data, meta: buildMeta(total, pagination) };
}

export async function createUser(data: { name: string; email: string; password: string; role: 'super_admin' | 'gestor' | 'consultor' | 'client'; clientId?: string | null }) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email))
    .limit(1);

  if (existing) {
    throw new AppError(USER.EMAIL_IN_USE, 409);
  }

  const settings = await getSettingsMap();
  const mustChangePassword = settings['must_change_password_on_create'] === 'true';
  const appName = settings['app_name'] || 'Template Base';

  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const [created] = await db
    .insert(users)
    .values({
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      isActive: true,
      mustChangePassword,
      clientId: data.role === 'client' ? (data.clientId ?? null) : null,
    })
    .returning(safeFields);

  // Send welcome email with temporary credentials
  try {
    const emailData = buildWelcomeEmail({
      name: data.name,
      email: data.email,
      tempPassword: data.password,
      appName,
      loginUrl: `${env.FRONTEND_URL}/login`,
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: data.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });
  } catch (err) {
    logger.error({ err, userId: created.id }, 'Failed to send welcome email');
  }

  return created;
}

export async function updateUser(
  id: string,
  data: { name?: string; email?: string; role?: 'super_admin' | 'gestor' | 'consultor' | 'client'; isActive?: boolean; password?: string; clientId?: string | null },
) {
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    throw new AppError(USER.NOT_FOUND, 404);
  }

  if (data.email) {
    const [emailTaken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (emailTaken && emailTaken.id !== id) {
      throw new AppError(USER.EMAIL_IN_USE, 409);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.clientId !== undefined) updateData.clientId = data.clientId;
  if (data.password) {
    updateData.passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
  }

  const [updated] = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, id))
    .returning(safeFields);

  return updated;
}

export async function getUserClientId(userId: string, userRole: string): Promise<string | undefined> {
  if (userRole !== 'client') return undefined;
  const [user] = await db.select({ clientId: users.clientId }).from(users).where(eq(users.id, userId)).limit(1);
  return user?.clientId ?? undefined;
}

export async function deactivateUser(id: string, requestingUserId: string) {
  if (id === requestingUserId) {
    throw new AppError(USER.CANNOT_DEACTIVATE_SELF, 400);
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    throw new AppError(USER.NOT_FOUND, 404);
  }

  const [updated] = await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning(safeFields);

  return updated;
}
