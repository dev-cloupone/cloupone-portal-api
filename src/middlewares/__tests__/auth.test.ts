import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../../utils/app-error'

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
  },
}))

vi.mock('../../config/env', () => ({
  env: { JWT_SECRET: 'test-secret-key-32chars-minimum!!' },
}))

import jwt from 'jsonwebtoken'
import { auth } from '../auth'

function createMocks(authHeader?: string) {
  const req = {
    headers: { authorization: authHeader },
  } as unknown as Request
  const res = {} as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next }
}

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts token from Authorization: Bearer <token> header', () => {
    vi.mocked(jwt.verify).mockReturnValue({
      userId: 'u1', role: 'consultor', clientId: null,
    } as never)
    const { req, res, next } = createMocks('Bearer valid-token')
    auth(req, res, next)
    expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret-key-32chars-minimum!!')
  })

  it('verifies token with jwt.verify and JWT_SECRET', () => {
    vi.mocked(jwt.verify).mockReturnValue({
      userId: 'u1', role: 'super_admin', clientId: null,
    } as never)
    const { req, res, next } = createMocks('Bearer my-token')
    auth(req, res, next)
    expect(jwt.verify).toHaveBeenCalledWith('my-token', 'test-secret-key-32chars-minimum!!')
  })

  it('sets req.userId, req.userRole, req.userClientId from payload', () => {
    vi.mocked(jwt.verify).mockReturnValue({
      userId: 'u1', role: 'gestor', clientId: 'c1',
    } as never)
    const { req, res, next } = createMocks('Bearer token')
    auth(req, res, next)
    expect(req.userId).toBe('u1')
    expect(req.userRole).toBe('gestor')
    expect(req.userClientId).toBe('c1')
  })

  it('calls next() after success', () => {
    vi.mocked(jwt.verify).mockReturnValue({
      userId: 'u1', role: 'consultor', clientId: null,
    } as never)
    const { req, res, next } = createMocks('Bearer token')
    auth(req, res, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next } = createMocks(undefined)
    auth(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = vi.mocked(next).mock.calls[0][0] as AppError
    expect(err.status).toBe(401)
  })

  it('returns 401 when header format is invalid (no Bearer)', () => {
    const { req, res, next } = createMocks('Basic token')
    auth(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = vi.mocked(next).mock.calls[0][0] as AppError
    expect(err.status).toBe(401)
  })

  it('returns 401 when token is invalid/expired (jwt.verify throws)', () => {
    vi.mocked(jwt.verify).mockImplementation(() => {
      throw new Error('jwt expired')
    })
    const { req, res, next } = createMocks('Bearer expired-token')
    auth(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = vi.mocked(next).mock.calls[0][0] as AppError
    expect(err.status).toBe(401)
  })
})
