import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RATE_LIMIT } from '../utils/error-messages';

// Auth sensível: 10 req/min por IP (login, forgot/reset password)
export const authSensitiveRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: RATE_LIMIT.TOO_MANY_ATTEMPTS },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth geral: 20 req/min por IP (refresh, logout)
export const authGeneralRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: RATE_LIMIT.TOO_MANY_REQUESTS },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: keyGenerator que usa userId com fallback para IP
const authKeyGenerator = (req: any, res: any): string => {
  return req.userId || ipKeyGenerator(req, res);
};

// Busca: 20 req/min por usuário
export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: authKeyGenerator,
  message: { error: RATE_LIMIT.TOO_MANY_REQUESTS },
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin/geral autenticado: 60 req/min por usuário
export const authenticatedRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: authKeyGenerator,
  message: { error: RATE_LIMIT.TOO_MANY_REQUESTS },
  standardHeaders: true,
  legacyHeaders: false,
});

// Global: 200 req/min por IP
export const globalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  message: { error: RATE_LIMIT.TOO_MANY_REQUESTS },
  standardHeaders: true,
  legacyHeaders: false,
});
