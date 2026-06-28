import type { RequestHandler } from 'express';
import { appError } from '../utils/app-error';
import { MIDDLEWARE } from '../utils/error-messages';

export const authorize = (...allowedRoles: string[]): RequestHandler => {
  return (req, _res, next) => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      return next(appError(MIDDLEWARE.INSUFFICIENT_PERMISSIONS, 403));
    }
    next();
  };
};
