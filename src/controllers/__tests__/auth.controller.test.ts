import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/auth.service', () => ({
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn(),
  updateMe: vi.fn(),
  changePassword: vi.fn(),
}))

vi.mock('../../services/login-history.service', () => ({
  getByUserId: vi.fn(),
}))

vi.mock('../../services/platform-settings.service', () => ({
  getSetting: vi.fn(),
}))

vi.mock('../../providers/email', () => ({
  getEmailProvider: vi.fn(() => ({ send: vi.fn().mockResolvedValue(undefined) })),
}))

vi.mock('../../emails', () => ({
  buildWelcomeSelfRegisterEmail: vi.fn(() => ({ subject: 's', text: 't', html: 'h' })),
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    query: { users: { findFirst: vi.fn() } },
  },
}))

vi.mock('../../db/schema', () => ({
  users: { id: 'id', name: 'name', email: 'email', role: 'role', createdAt: 'createdAt' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
}))

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-pw') },
}))

vi.mock('../../config/env', () => ({
  env: { FRONTEND_URL: 'http://localhost:5173' },
}))

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn() },
}))

vi.mock('../../utils/auth-cookies', () => ({
  setRefreshTokenCookie: vi.fn(),
  clearRefreshTokenCookie: vi.fn(),
}))

import * as authService from '../../services/auth.service'
import * as loginHistoryService from '../../services/login-history.service'
import { getSetting } from '../../services/platform-settings.service'
import { setRefreshTokenCookie, clearRefreshTokenCookie } from '../../utils/auth-cookies'
import { authController } from '../auth.controller'
import { db } from '../../db'
import { createChain } from '../../__test-utils__/drizzle-chain'

function createMocks(overrides: {
  body?: Record<string, unknown>
  cookies?: Record<string, string>
  headers?: Record<string, string>
  userId?: string
} = {}) {
  const req = {
    body: overrides.body ?? {},
    cookies: overrides.cookies ?? {},
    headers: overrides.headers ?? {},
    userId: overrides.userId,
    ip: '127.0.0.1',
  } as unknown as Request

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  } as unknown as Response

  const next = vi.fn() as unknown as NextFunction

  return { req, res, next }
}

describe('authController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('login', () => {
    it('parses email/password from body', async () => {
      const loginResult = {
        tokens: { accessToken: 'at', refreshToken: 'rt' },
        user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'consultor' },
      }
      vi.mocked(authService.login).mockResolvedValue(loginResult)

      const { req, res, next } = createMocks({
        body: { email: 'test@test.com', password: 'password123' },
        headers: { 'user-agent': 'test-agent' },
      })

      await authController.login(req, res, next)

      expect(authService.login).toHaveBeenCalledWith(
        'test@test.com',
        'password123',
        expect.objectContaining({ userAgent: 'test-agent' }),
      )
    })

    it('sets refresh token cookie in response', async () => {
      const loginResult = {
        tokens: { accessToken: 'at', refreshToken: 'rt-value' },
        user: { id: 'u1', name: 'Test', email: 'test@test.com', role: 'consultor' },
      }
      vi.mocked(authService.login).mockResolvedValue(loginResult)

      const { req, res, next } = createMocks({
        body: { email: 'test@test.com', password: 'password123' },
      })

      await authController.login(req, res, next)

      expect(setRefreshTokenCookie).toHaveBeenCalledWith(res, 'rt-value')
    })

    it('returns access token and user data', async () => {
      const user = { id: 'u1', name: 'Test', email: 'test@test.com', role: 'consultor' }
      const loginResult = {
        tokens: { accessToken: 'access-123', refreshToken: 'rt' },
        user,
      }
      vi.mocked(authService.login).mockResolvedValue(loginResult)

      const { req, res, next } = createMocks({
        body: { email: 'test@test.com', password: 'password123' },
      })

      await authController.login(req, res, next)

      expect(res.json).toHaveBeenCalledWith({
        accessToken: 'access-123',
        user,
      })
    })
  })

  describe('refreshToken', () => {
    it('extracts refresh token from cookie', async () => {
      const refreshResult = { accessToken: 'new-at', refreshToken: 'new-rt' }
      vi.mocked(authService.refresh).mockResolvedValue(refreshResult)

      const { req, res, next } = createMocks({
        cookies: { refreshToken: 'old-rt' },
      })

      await authController.refresh(req, res, next)

      expect(authService.refresh).toHaveBeenCalledWith('old-rt')
      expect(res.json).toHaveBeenCalledWith({ accessToken: 'new-at' })
    })

    it('returns 401 when cookie is missing', async () => {
      const { req, res, next } = createMocks({ cookies: {} })

      await authController.refresh(req, res, next)

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
      expect(authService.refresh).not.toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('revokes token and clears cookie', async () => {
      vi.mocked(authService.logout).mockResolvedValue(undefined)

      const { req, res, next } = createMocks({
        cookies: { refreshToken: 'rt-to-revoke' },
      })

      await authController.logout(req, res, next)

      expect(authService.logout).toHaveBeenCalledWith('rt-to-revoke')
      expect(clearRefreshTokenCookie).toHaveBeenCalledWith(res)
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' })
    })

    it('clears cookie even when no refresh token exists', async () => {
      const { req, res, next } = createMocks({ cookies: {} })

      await authController.logout(req, res, next)

      expect(authService.logout).not.toHaveBeenCalled()
      expect(clearRefreshTokenCookie).toHaveBeenCalledWith(res)
      expect(res.json).toHaveBeenCalledWith({ message: 'Logged out successfully' })
    })
  })

  describe('getMe', () => {
    it('returns user data', async () => {
      const user = { id: 'u1', name: 'Test', email: 'test@test.com' }
      vi.mocked(authService.getMe).mockResolvedValue(user as never)

      const { req, res, next } = createMocks({ userId: 'u1' })

      await authController.getMe(req, res, next)

      expect(authService.getMe).toHaveBeenCalledWith('u1')
      expect(res.json).toHaveBeenCalledWith({ user })
    })

    it('calls next on error', async () => {
      const err = new Error('fail')
      vi.mocked(authService.getMe).mockRejectedValue(err)

      const { req, res, next } = createMocks({ userId: 'u1' })

      await authController.getMe(req, res, next)

      expect(next).toHaveBeenCalledWith(err)
    })
  })

  describe('updateMe', () => {
    it('parses body and delegates to authService.updateMe', async () => {
      const user = { id: 'u1', name: 'Updated' }
      vi.mocked(authService.updateMe).mockResolvedValue(user as never)

      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { name: 'Updated' },
      })

      await authController.updateMe(req, res, next)

      expect(authService.updateMe).toHaveBeenCalledWith('u1', { name: 'Updated' })
      expect(res.json).toHaveBeenCalledWith({ user })
    })

    it('calls next on validation error', async () => {
      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { email: 'not-an-email' },
      })

      await authController.updateMe(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('changePassword', () => {
    it('delegates to authService.changePassword', async () => {
      vi.mocked(authService.changePassword).mockResolvedValue(undefined as never)

      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { currentPassword: 'old-pass', newPassword: 'new-pass-123' },
      })

      await authController.changePassword(req, res, next)

      expect(authService.changePassword).toHaveBeenCalledWith('u1', 'old-pass', 'new-pass-123')
      expect(res.json).toHaveBeenCalledWith({ message: 'Password changed successfully' })
    })

    it('calls next on validation error for short password', async () => {
      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { currentPassword: 'old', newPassword: 'short' },
      })

      await authController.changePassword(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(authService.changePassword).not.toHaveBeenCalled()
    })
  })

  describe('getMyLoginHistory', () => {
    it('returns login history for current user', async () => {
      const entries = [{ id: 'lh1', ipAddress: '127.0.0.1' }]
      vi.mocked(loginHistoryService.getByUserId).mockResolvedValue(entries as never)

      const { req, res, next } = createMocks({ userId: 'u1' })

      await authController.getMyLoginHistory(req, res, next)

      expect(loginHistoryService.getByUserId).toHaveBeenCalledWith('u1', 20)
      expect(res.json).toHaveBeenCalledWith({ data: entries })
    })
  })

  describe('register', () => {
    it('creates user when self-registration is enabled', async () => {
      vi.mocked(getSetting)
        .mockResolvedValueOnce('true')  // allow_self_registration
        .mockResolvedValueOnce('Portal') // app_name

      const emptyChain = createChain([])
      vi.mocked(db.select).mockReturnValue(emptyChain as never)

      const created = { id: 'u-new', name: 'New User', email: 'new@test.com', role: 'client', createdAt: new Date() }
      const insertChain = createChain([created])
      vi.mocked(db.insert).mockReturnValue(insertChain as never)

      const { req, res, next } = createMocks({
        body: { name: 'New User', email: 'new@test.com', password: 'password123' },
      })

      await authController.register(req, res, next)

      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(created)
    })

    it('throws 403 when self-registration is disabled', async () => {
      vi.mocked(getSetting).mockResolvedValueOnce('false')

      const { req, res, next } = createMocks({
        body: { name: 'X', email: 'x@test.com', password: 'password123' },
      })

      await authController.register(req, res, next)

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Registro de novos usuários está desabilitado.' }),
      )
    })

    it('throws 409 when email already exists', async () => {
      vi.mocked(getSetting).mockResolvedValueOnce('true')

      const existingChain = createChain([{ id: 'u-existing' }])
      vi.mocked(db.select).mockReturnValue(existingChain as never)

      const { req, res, next } = createMocks({
        body: { name: 'X', email: 'existing@test.com', password: 'password123' },
      })

      await authController.register(req, res, next)

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Este email já está em uso.' }),
      )
    })
  })

  describe('forceChangePassword', () => {
    it('changes password when mustChangePassword is true', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue({ id: 'u1', mustChangePassword: true } as never)
      vi.mocked(authService.changePassword).mockResolvedValue(undefined as never)

      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { currentPassword: 'old-pass', newPassword: 'new-pass-123' },
      })

      await authController.forceChangePassword(req, res, next)

      expect(authService.changePassword).toHaveBeenCalledWith('u1', 'old-pass', 'new-pass-123')
      expect(res.json).toHaveBeenCalledWith({ message: 'Senha alterada com sucesso.' })
    })

    it('throws 400 when mustChangePassword is false', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue({ id: 'u1', mustChangePassword: false } as never)

      const { req, res, next } = createMocks({
        userId: 'u1',
        body: { currentPassword: 'old', newPassword: 'new-pass-123' },
      })

      await authController.forceChangePassword(req, res, next)

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Troca de senha não é necessária.' }),
      )
    })

    it('throws 400 when user not found', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined as never)

      const { req, res, next } = createMocks({
        userId: 'u-missing',
        body: { currentPassword: 'old', newPassword: 'new-pass-123' },
      })

      await authController.forceChangePassword(req, res, next)

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Troca de senha não é necessária.' }),
      )
    })
  })

  describe('login - edge cases', () => {
    it('calls next when login throws', async () => {
      const err = new Error('Invalid credentials')
      vi.mocked(authService.login).mockRejectedValue(err)

      const { req, res, next } = createMocks({
        body: { email: 'test@test.com', password: 'wrong' },
      })

      await authController.login(req, res, next)

      expect(next).toHaveBeenCalledWith(err)
    })

    it('calls next on validation error (missing email)', async () => {
      const { req, res, next } = createMocks({
        body: { password: 'password123' },
      })

      await authController.login(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(authService.login).not.toHaveBeenCalled()
    })
  })
})
