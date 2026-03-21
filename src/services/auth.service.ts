import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { users, refreshTokens } from '../db/schema';
import { env } from '../config/env';
import type { JwtPayload, TokenPair } from '../types/auth.types';
import { AppError } from '../utils/app-error';
import { AUTH } from '../utils/error-messages';
import { getSettingsMap } from './platform-settings.service';
import { getEmailProvider } from '../providers/email';
import { buildPasswordChangedEmail } from '../emails';
import { logger } from '../utils/logger';
import * as loginHistoryService from './login-history.service';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

function generateTokens(user: { id: string; role: string; clientId?: string | null }): { accessToken: string; refreshTokenValue: string } {
  const payload: JwtPayload = {
    userId: user.id,
    role: user.role as JwtPayload['role'],
    clientId: user.clientId ?? null,
  };

  const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  const refreshTokenValue = crypto.randomUUID();

  return { accessToken, refreshTokenValue };
}

async function saveRefreshToken(userId: string, token: string): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.insert(refreshTokens).values({
    userId,
    token,
    expiresAt,
  });
}

export async function login(
  email: string,
  password: string,
  meta: { ipAddress: string; userAgent: string },
): Promise<{ tokens: TokenPair; user: { id: string; name: string; email: string; role: string; mustChangePassword: boolean } }> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user || !user.isActive) {
    loginHistoryService.recordAttempt({
      userId: user?.id ?? null,
      success: false,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch((err) => logger.error({ err }, 'Failed to record login attempt'));
    throw new AppError(AUTH.INVALID_CREDENTIALS, 401);
  }

  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) {
    loginHistoryService.recordAttempt({
      userId: user.id,
      success: false,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    }).catch((err) => logger.error({ err }, 'Failed to record login attempt'));
    throw new AppError(AUTH.INVALID_CREDENTIALS, 401);
  }

  const { accessToken, refreshTokenValue } = generateTokens(user);
  await saveRefreshToken(user.id, refreshTokenValue);

  loginHistoryService.recordAttempt({
    userId: user.id,
    success: true,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  }).catch((err) => logger.error({ err }, 'Failed to record login attempt'));

  return {
    tokens: { accessToken, refreshToken: refreshTokenValue },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  };
}

export async function refresh(refreshToken: string): Promise<TokenPair> {
  const storedToken = await db.query.refreshTokens.findFirst({
    where: and(
      eq(refreshTokens.token, refreshToken),
      eq(refreshTokens.isRevoked, false),
    ),
  });

  if (!storedToken || storedToken.expiresAt < new Date()) {
    throw new AppError(AUTH.TOKEN_INVALID, 401);
  }

  await db.update(refreshTokens)
    .set({ isRevoked: true })
    .where(eq(refreshTokens.id, storedToken.id));

  const user = await db.query.users.findFirst({
    where: eq(users.id, storedToken.userId),
  });

  if (!user || !user.isActive) {
    throw new AppError(AUTH.USER_INACTIVE, 401);
  }

  const { accessToken, refreshTokenValue } = generateTokens(user);
  await saveRefreshToken(user.id, refreshTokenValue);

  return { accessToken, refreshToken: refreshTokenValue };
}

export async function logout(refreshToken: string): Promise<void> {
  await db.update(refreshTokens)
    .set({ isRevoked: true })
    .where(eq(refreshTokens.token, refreshToken));
}

export async function generateTokensForUser(user: { id: string; role: string }): Promise<TokenPair> {
  const { accessToken, refreshTokenValue } = generateTokens(user);
  await saveRefreshToken(user.id, refreshTokenValue);
  return { accessToken, refreshToken: refreshTokenValue };
}

export async function getMe(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new AppError(AUTH.USER_INACTIVE, 404);
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    avatarFileId: user.avatarFileId,
    createdAt: user.createdAt,
  };
}

export async function updateMe(userId: string, data: { name?: string; email?: string }) {
  const [updated] = await db.update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw new AppError(AUTH.USER_INACTIVE, 404);
  }

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
    createdAt: updated.createdAt,
  };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new AppError(AUTH.USER_INACTIVE, 404);
  }

  const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordValid) {
    throw new AppError(AUTH.INVALID_CREDENTIALS, 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // Send password changed notification email
  try {
    const settings = await getSettingsMap();
    const appName = settings['app_name'] || 'Template Base';
    const emailData = buildPasswordChangedEmail({
      name: user.name,
      appName,
      timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to send password changed email');
  }
}
