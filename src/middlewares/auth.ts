import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { JwtPayload } from '../types/auth.types';
import { appError, AppError } from '../utils/app-error';
import { MIDDLEWARE, AUTH } from '../utils/error-messages';

function applyToken(req: Request, token: string): AppError | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userClientId = payload.clientId;
    return null;
  } catch {
    return appError(AUTH.TOKEN_INVALID, 401);
  }
}

export const auth: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(appError(MIDDLEWARE.AUTH_REQUIRED, 401));
  }

  const err = applyToken(req, authHeader.slice(7));
  return err ? next(err) : next();
};

/**
 * Auth exclusivo para EventSource: a API do browser nao permite enviar header
 * Authorization, entao o token vem por query string. Escopado a rota de stream
 * para que o JWT nao apareca em URL de nenhum outro endpoint (access log de
 * proxy, historico do browser, header Referer).
 */
export const sseAuth: RequestHandler = (req, _res, next) => {
  const raw = req.query.token;
  // ?token=a&token=b chega como array — so aceitamos o formato escalar.
  const token = typeof raw === 'string' ? raw : undefined;
  if (!token) {
    return next(appError(MIDDLEWARE.AUTH_REQUIRED, 401));
  }

  const err = applyToken(req, token);
  return err ? next(err) : next();
};
