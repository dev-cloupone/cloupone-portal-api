import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

// Hoisted mocks
const { mockBcrypt, mockJwt, mockCrypto, mockRecordAttempt, mockEmailSend } = vi.hoisted(() => ({
  mockBcrypt: { compare: vi.fn(), hash: vi.fn() },
  mockJwt: { sign: vi.fn() },
  mockCrypto: { randomUUID: vi.fn() },
  mockRecordAttempt: vi.fn().mockResolvedValue(undefined),
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('bcrypt', () => ({ default: mockBcrypt }))
vi.mock('jsonwebtoken', () => ({ default: mockJwt }))
vi.mock('crypto', () => ({ default: mockCrypto }))
vi.mock('../../config/env', () => ({
  env: { JWT_SECRET: 'test-secret', JWT_REFRESH_SECRET: 'test-refresh-secret', NODE_ENV: 'test', FRONTEND_URL: 'http://localhost:5173' },
}))
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('../../db/schema', () => ({
  users: { id: 'id', email: 'email', isActive: 'isActive', passwordHash: 'passwordHash' },
  refreshTokens: { id: 'id', token: 'token', userId: 'userId', isRevoked: 'isRevoked', expiresAt: 'expiresAt' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
}))

vi.mock('../login-history.service', () => ({
  recordAttempt: mockRecordAttempt,
}))
vi.mock('../platform-settings.service', () => ({
  getSettingsMap: vi.fn().mockResolvedValue({ app_name: 'Test App' }),
}))
vi.mock('../../providers/email', () => ({
  getEmailProvider: vi.fn().mockReturnValue({ send: mockEmailSend }),
}))
vi.mock('../../emails', () => ({
  buildPasswordChangedEmail: vi.fn().mockReturnValue({ subject: 's', text: 't', html: 'h' }),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      refreshTokens: { findFirst: vi.fn() },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

import { login, refresh, logout, getMe, updateMe, changePassword } from '../auth.service'
import { db } from '../../db'

const mockUser = {
  id: 'u1',
  name: 'Test User',
  email: 'test@test.com',
  role: 'consultor',
  isActive: true,
  passwordHash: 'hashed-pw',
  mustChangePassword: false,
  clientId: null,
  avatarFileId: null,
  locale: 'pt-BR',
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJwt.sign.mockReturnValue('access-token')
    mockCrypto.randomUUID.mockReturnValue('refresh-token-uuid')
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
  })

  it('returns tokens and user data for valid credentials', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)

    const result = await login('test@test.com', 'password', { ipAddress: '127.0.0.1', userAgent: 'test' })
    expect(result.tokens.accessToken).toBe('access-token')
    expect(result.tokens.refreshToken).toBe('refresh-token-uuid')
    expect(result.user.id).toBe('u1')
    expect(result.user.email).toBe('test@test.com')
  })

  it('throws 401 for email not found', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(null as never)
    await expect(login('nope@test.com', 'pw', { ipAddress: '1', userAgent: 'a' })).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 for incorrect password', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(false)
    await expect(login('test@test.com', 'wrong', { ipAddress: '1', userAgent: 'a' })).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 for inactive user', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ ...mockUser, isActive: false } as never)
    await expect(login('test@test.com', 'pw', { ipAddress: '1', userAgent: 'a' })).rejects.toMatchObject({ status: 401 })
  })

  it('records login attempt in history', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)
    await login('test@test.com', 'password', { ipAddress: '127.0.0.1', userAgent: 'test' })
    expect(mockRecordAttempt).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', success: true,
    }))
  })

  it('stores refresh token in database with expiry', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)
    const insertChain = createChain([])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)
    await login('test@test.com', 'password', { ipAddress: '127.0.0.1', userAgent: 'test' })
    expect(db.insert).toHaveBeenCalled()
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', token: 'refresh-token-uuid',
    }))
  })
})

describe('refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJwt.sign.mockReturnValue('new-access-token')
    mockCrypto.randomUUID.mockReturnValue('new-refresh-uuid')
    vi.mocked(db.update).mockReturnValue(createChain() as never)
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
  })

  it('returns new token pair for valid refresh token', async () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 7)
    vi.mocked(db.query.refreshTokens.findFirst).mockResolvedValue({
      id: 'rt1', userId: 'u1', token: 'old-token', isRevoked: false, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)

    const result = await refresh('old-token')
    expect(result.accessToken).toBe('new-access-token')
    expect(result.refreshToken).toBe('new-refresh-uuid')
  })

  it('throws 401 for refresh token not found', async () => {
    vi.mocked(db.query.refreshTokens.findFirst).mockResolvedValue(null as never)
    await expect(refresh('invalid')).rejects.toMatchObject({ status: 401 })
  })

  it('throws 401 for expired refresh token', async () => {
    vi.mocked(db.query.refreshTokens.findFirst).mockResolvedValue({
      id: 'rt1', userId: 'u1', token: 'old-token', isRevoked: false, expiresAt: new Date('2020-01-01'),
    } as never)
    await expect(refresh('old-token')).rejects.toMatchObject({ status: 401 })
  })

  it('revokes old token and creates new one', async () => {
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 7)
    vi.mocked(db.query.refreshTokens.findFirst).mockResolvedValue({
      id: 'rt1', userId: 'u1', token: 'old-token', isRevoked: false, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    const updateChain = createChain()
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await refresh('old-token')
    expect(db.update).toHaveBeenCalled()
    expect(updateChain.set).toHaveBeenCalledWith({ isRevoked: true })
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.update).mockReturnValue(createChain() as never)
  })

  it('revokes refresh token', async () => {
    const updateChain = createChain()
    vi.mocked(db.update).mockReturnValue(updateChain as never)
    await logout('some-token')
    expect(db.update).toHaveBeenCalled()
    expect(updateChain.set).toHaveBeenCalledWith({ isRevoked: true })
  })

  it('does not throw error for non-existent token', async () => {
    await expect(logout('non-existent')).resolves.toBeUndefined()
  })
})

describe('getMe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns user data by id', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    const result = await getMe('u1')
    expect(result.id).toBe('u1')
    expect(result.email).toBe('test@test.com')
  })

  it('throws 404 for user not found', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(null as never)
    await expect(getMe('u999')).rejects.toMatchObject({ status: 404 })
  })
})

describe('updateMe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates user name and email', async () => {
    vi.mocked(db.update).mockReturnValue(createChain([{ ...mockUser, name: 'New Name' }]) as never)
    const result = await updateMe('u1', { name: 'New Name' })
    expect(result.name).toBe('New Name')
  })

  it('returns updated user', async () => {
    vi.mocked(db.update).mockReturnValue(createChain([{ ...mockUser, email: 'new@test.com' }]) as never)
    const result = await updateMe('u1', { email: 'new@test.com' })
    expect(result.email).toBe('new@test.com')
  })
})

describe('changePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.update).mockReturnValue(createChain() as never)
    mockEmailSend.mockResolvedValue(undefined)
  })

  it('changes password when current password is correct', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)
    mockBcrypt.hash.mockResolvedValue('new-hash')
    await expect(changePassword('u1', 'old-pw', 'new-pw')).resolves.toBeUndefined()
    expect(mockBcrypt.hash).toHaveBeenCalledWith('new-pw', 12)
  })

  it('throws 401 when current password is incorrect', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(false)
    await expect(changePassword('u1', 'wrong', 'new-pw')).rejects.toMatchObject({ status: 401 })
  })

  it('sends notification email after change', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)
    mockBcrypt.hash.mockResolvedValue('new-hash')
    await changePassword('u1', 'old-pw', 'new-pw')
    expect(mockEmailSend).toHaveBeenCalled()
  })
})
