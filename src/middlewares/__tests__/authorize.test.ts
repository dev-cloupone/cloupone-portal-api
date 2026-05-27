import { describe, it, expect, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../../utils/app-error'
import { authorize } from '../authorize'

function createMocks(userRole?: string) {
  const req = { userRole } as unknown as Request
  const res = {} as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, next }
}

describe('authorize', () => {
  it('calls next() when req.userRole is in the allowed roles list', () => {
    const middleware = authorize('super_admin', 'gestor')
    const { req, res, next } = createMocks('super_admin')
    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('calls next() when multiple roles are allowed and user has one of them', () => {
    const middleware = authorize('gestor', 'consultor')
    const { req, res, next } = createMocks('consultor')
    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith()
  })

  it('returns 403 when req.userRole is not in the list', () => {
    const middleware = authorize('super_admin')
    const { req, res, next } = createMocks('consultor')
    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = vi.mocked(next).mock.calls[0][0] as AppError
    expect(err.status).toBe(403)
  })

  it('returns 403 when req.userRole is undefined', () => {
    const middleware = authorize('super_admin')
    const { req, res, next } = createMocks(undefined)
    middleware(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.any(AppError))
    const err = vi.mocked(next).mock.calls[0][0] as AppError
    expect(err.status).toBe(403)
  })
})
