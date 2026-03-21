import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db';
import { users, passwordResetTokens, refreshTokens } from '../db/schema';
import { getSettingsMap } from './platform-settings.service';
import { getEmailProvider } from '../providers/email';
import { AppError } from '../utils/app-error';
import { PASSWORD_RESET } from '../utils/error-messages';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { buildPasswordResetEmail } from '../emails';

const SALT_ROUNDS = 12;
const DEFAULT_EXPIRY_MINUTES = 60;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateResetToken(): { raw: string; hashed: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hashed = hashToken(raw);
  return { raw, hashed };
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });

  if (!user || !user.isActive) {
    logger.debug({ email }, 'Password reset requested for unknown/inactive email');
    return;
  }

  const { raw, hashed } = generateResetToken();

  const settings = await getSettingsMap();
  const expiryMinutes = parseInt(settings['password_reset_expiry_minutes'] ?? '', 10) || DEFAULT_EXPIRY_MINUTES;
  const appName = settings['app_name'] || 'Template Base';

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + expiryMinutes);

  await db.transaction(async (tx) => {
    await tx.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      token: hashed,
      expiresAt,
    });
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password/${raw}`;

  try {
    const emailData = buildPasswordResetEmail({
      name: user.name,
      resetUrl,
      expiryMinutes,
      appName,
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });
    logger.info({ userId: user.id }, 'Password reset token generated and email sent');
  } catch (err) {
    logger.error({ err, userId: user.id }, 'Failed to send password reset email');
  }
}

export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const hashed = hashToken(rawToken);

  const resetToken = await db.query.passwordResetTokens.findFirst({
    where: eq(passwordResetTokens.token, hashed),
  });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AppError(PASSWORD_RESET.TOKEN_INVALID, 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, resetToken.userId),
  });

  if (!user || !user.isActive) {
    throw new AppError(PASSWORD_RESET.TOKEN_INVALID, 400);
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
  if (isSamePassword) {
    throw new AppError(PASSWORD_RESET.SAME_PASSWORD, 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.transaction(async (tx) => {
    await tx.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    await tx.update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetToken.id));

    await tx.update(refreshTokens)
      .set({ isRevoked: true })
      .where(eq(refreshTokens.userId, user.id));
  });

  logger.info({ userId: user.id }, 'Password reset completed, all refresh tokens revoked');
}
