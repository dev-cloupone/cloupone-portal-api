import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../../utils/app-error'

vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { errorHandler } from '../error-handler'
import { logger } from '../../utils/logger'

function createMocks() {
  const req = {} as Request
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next }
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('responds with status and message from AppError', () => {
    const { req, res, next } = createMocks()
    const err = new AppError('Not found', 404)
    errorHandler(err, req, res, next)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' })
  })

  it('responds with AppError code when present', () => {
    const { req, res, next } = createMocks()
    const err = new AppError('Conflict', 409, 'DUPLICATE')
    errorHandler(err, req, res, next)
    expect(res.json).toHaveBeenCalledWith({ error: 'Conflict', code: 'DUPLICATE' })
  })

  it('responds 400 with formatted fields for ZodError', () => {
    const { req, res, next } = createMocks()
    const zodErr = new ZodError([
      {
        code: 'too_small',
        minimum: 1,
        type: 'string',
        inclusive: true,
        message: 'Required',
        path: ['email'],
      },
    ])
    errorHandler(zodErr, req, res, next)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'VALIDATION_ERROR',
      fields: [{ field: 'email', message: 'Required' }],
    }))
  })

  it('responds 500 with generic message for unknown error', () => {
    const { req, res, next } = createMocks()
    const err = new Error('something broke')
    errorHandler(err, req, res, next)
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(String),
    }))
  })

  it('logs unknown error via logger.error', () => {
    const { req, res, next } = createMocks()
    const err = new Error('unexpected')
    errorHandler(err, req, res, next)
    expect(logger.error).toHaveBeenCalled()
  })

  it('does not log AppError', () => {
    const { req, res, next } = createMocks()
    const err = new AppError('Bad request', 400)
    errorHandler(err, req, res, next)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
