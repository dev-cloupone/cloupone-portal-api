import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { JwtPayload } from '../types/auth.types';
import { AppError } from '../utils/app-error';
import { MIDDLEWARE, AUTH } from '../utils/error-messages';

export const auth: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError(MIDDLEWARE.AUTH_REQUIRED, 401));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userClientId = payload.clientId;
    next();
  } catch {
    next(new AppError(AUTH.TOKEN_INVALID, 401));
  }
};
