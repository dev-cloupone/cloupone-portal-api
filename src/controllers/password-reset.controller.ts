import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as passwordResetService from '../services/password-reset.service';
import { PASSWORD_RESET } from '../utils/error-messages';
import { V } from '../utils/validation-messages';

const forgotPasswordSchema = z.object({
  email: z.string().email(V.emailInvalid),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, V.required('Token')),
  password: z.string().min(8, V.min('Senha', 8)),
});

const forgotPassword: RequestHandler = async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await passwordResetService.requestPasswordReset(email);
    res.json({ message: PASSWORD_RESET.EMAIL_SENT });
  } catch (err) {
    next(err);
  }
};

const resetPassword: RequestHandler = async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await passwordResetService.resetPassword(token, password);
    res.json({ message: PASSWORD_RESET.PASSWORD_CHANGED });
  } catch (err) {
    next(err);
  }
};

export const passwordResetController = { forgotPassword, resetPassword };
