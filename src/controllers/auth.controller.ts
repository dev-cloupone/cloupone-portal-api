import type { RequestHandler } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import * as authService from '../services/auth.service';
import * as loginHistoryService from '../services/login-history.service';
import { getSetting } from '../services/platform-settings.service';
import { getEmailProvider } from '../providers/email';
import { buildWelcomeSelfRegisterEmail } from '../emails';
import { db } from '../db';
import { users } from '../db/schema';
import { env } from '../config/env';
import { setRefreshTokenCookie, clearRefreshTokenCookie } from '../utils/auth-cookies';
import { AppError } from '../utils/app-error';
import { AUTH } from '../utils/error-messages';
import { V } from '../utils/validation-messages';
import { logger } from '../utils/logger';

const loginSchema = z.object({
  email: z.string().email(V.emailInvalid),
  password: z.string().min(1, V.requiredFem('Senha')),
});

const login: RequestHandler = async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const result = await authService.login(parsed.email, parsed.password, { ipAddress, userAgent });

    setRefreshTokenCookie(res, result.tokens.refreshToken);

    res.json({
      accessToken: result.tokens.accessToken,
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
};

const refreshToken: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (!token) {
      throw new AppError(AUTH.REFRESH_TOKEN_REQUIRED, 401);
    }

    const result = await authService.refresh(token);

    setRefreshTokenCookie(res, result.refreshToken);

    res.json({
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
};

const logout: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken as string | undefined;
    if (token) {
      await authService.logout(token);
    }

    clearRefreshTokenCookie(res);

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

const getMe: RequestHandler = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.userId!);
    res.json({ user });
  } catch (err) {
    next(err);
  }
};

const updateMeSchema = z.object({
  name: z.string().min(1, V.required('Nome')).optional(),
  email: z.string().email(V.emailInvalid).optional(),
});

const updateMe: RequestHandler = async (req, res, next) => {
  try {
    const parsed = updateMeSchema.parse(req.body);
    const user = await authService.updateMe(req.userId!, parsed);
    res.json({ user });
  } catch (err) {
    next(err);
  }
};

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, V.requiredFem('Senha atual')),
  newPassword: z.string().min(8, V.min('Nova senha', 8)),
});

const changePassword: RequestHandler = async (req, res, next) => {
  try {
    const parsed = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.userId!, parsed.currentPassword, parsed.newPassword);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
};

const getMyLoginHistory: RequestHandler = async (req, res, next) => {
  try {
    const entries = await loginHistoryService.getByUserId(req.userId!, 20);
    res.json({ data: entries });
  } catch (err) {
    next(err);
  }
};

const registerSchema = z.object({
  name: z.string().min(1, V.required('Nome')).max(200, V.max('Nome', 200)),
  email: z.string().email(V.emailInvalid),
  password: z.string().min(8, V.min('Senha', 8)),
});

const register: RequestHandler = async (req, res, next) => {
  try {
    const allowSelfReg = await getSetting('allow_self_registration');
    if (allowSelfReg !== 'true') {
      throw new AppError('Registro de novos usuários está desabilitado.', 403);
    }

    const parsed = registerSchema.parse(req.body);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email))
      .limit(1);

    if (existing) {
      throw new AppError('Este email já está em uso.', 409);
    }

    const passwordHash = await bcrypt.hash(parsed.password, 12);

    const [created] = await db
      .insert(users)
      .values({
        name: parsed.name,
        email: parsed.email,
        passwordHash,
        role: 'client',
        isActive: true,
        mustChangePassword: false,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      });

    // Send welcome email
    try {
      const appName = await getSetting('app_name') || 'Template Base';
      const emailData = buildWelcomeSelfRegisterEmail({
        name: parsed.name,
        appName,
        loginUrl: `${env.FRONTEND_URL}/login`,
      });
      const emailProvider = getEmailProvider();
      await emailProvider.send({
        to: parsed.email,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });
    } catch (err) {
      logger.error({ err, userId: created.id }, 'Failed to send welcome self-register email');
    }

    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

const forceChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, V.requiredFem('Senha atual')),
  newPassword: z.string().min(8, V.min('Nova senha', 8)),
});

const forceChangePassword: RequestHandler = async (req, res, next) => {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, req.userId!),
    });

    if (!user || !user.mustChangePassword) {
      throw new AppError('Troca de senha não é necessária.', 400);
    }

    const parsed = forceChangePasswordSchema.parse(req.body);
    await authService.changePassword(req.userId!, parsed.currentPassword, parsed.newPassword);

    res.json({ message: 'Senha alterada com sucesso.' });
  } catch (err) {
    next(err);
  }
};

export const authController = {
  login,
  refresh: refreshToken,
  logout,
  getMe,
  updateMe,
  changePassword,
  getMyLoginHistory,
  register,
  forceChangePassword,
};
