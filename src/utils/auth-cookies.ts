import type { Response } from 'express';
import { env } from '../config/env';

const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 dias em ms

function getCookieDomain(): string | undefined {
  if (env.NODE_ENV !== 'production' || !env.COOKIE_DOMAIN) return undefined;
  return env.COOKIE_DOMAIN;
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'strict',
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: '/api/auth',
    domain: getCookieDomain(),
  });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'strict',
    path: '/api/auth',
    domain: getCookieDomain(),
  });
}
