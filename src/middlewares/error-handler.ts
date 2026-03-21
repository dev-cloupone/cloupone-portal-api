import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/app-error';
import { logger } from '../utils/logger';
import { GENERIC } from '../utils/error-messages';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.code && { code: err.code }),
    });
    return;
  }

  if (err instanceof ZodError) {
    const fields = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(400).json({
      error: GENERIC.VALIDATION,
      code: 'VALIDATION_ERROR',
      fields,
    });
    return;
  }

  logger.error({ err, status: 500 }, 'Unhandled error');

  res.status(500).json({ error: GENERIC.INTERNAL });
};
