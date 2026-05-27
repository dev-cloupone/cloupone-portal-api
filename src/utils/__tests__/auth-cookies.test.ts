import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../config/env', () => ({
  env: {
    NODE_ENV: 'production',
    COOKIE_DOMAIN: '.cloupone.com.br',
  },
}))

import { setRefreshTokenCookie, clearRefreshTokenCookie } from '../auth-cookies'

function createMockRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as import('express').Response
}

describe('setRefreshTokenCookie', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets httpOnly cookie with token', () => {
    const res = createMockRes()
    setRefreshTokenCookie(res, 'test-token')
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'test-token', expect.objectContaining({
      httpOnly: true,
    }))
  })

  it('sets maxAge to 7 days', () => {
    const res = createMockRes()
    setRefreshTokenCookie(res, 'test-token')
    const opts = vi.mocked(res.cookie).mock.calls[0][2] as Record<string, unknown>
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('sets path to /api/auth', () => {
    const res = createMockRes()
    setRefreshTokenCookie(res, 'test-token')
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'test-token', expect.objectContaining({
      path: '/api/auth',
    }))
  })

  it('sets secure=true in production', () => {
    const res = createMockRes()
    setRefreshTokenCookie(res, 'test-token')
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'test-token', expect.objectContaining({
      secure: true,
    }))
  })

  it('sets sameSite=none in production', () => {
    const res = createMockRes()
    setRefreshTokenCookie(res, 'test-token')
    expect(res.cookie).toHaveBeenCalledWith('refreshToken', 'test-token', expect.objectContaining({
      sameSite: 'none',
    }))
  })
})

describe('clearRefreshTokenCookie', () => {
  it('clears cookie with clearCookie', () => {
    const res = createMockRes()
    clearRefreshTokenCookie(res)
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.objectContaining({
      httpOnly: true,
      path: '/api/auth',
    }))
  })

  it('uses same attributes as set', () => {
    const res = createMockRes()
    clearRefreshTokenCookie(res)
    expect(res.clearCookie).toHaveBeenCalledWith('refreshToken', expect.objectContaining({
      secure: true,
      sameSite: 'none',
    }))
  })
})
