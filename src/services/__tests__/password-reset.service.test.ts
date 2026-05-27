import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

const { mockBcrypt, mockCrypto, mockEmailSend } = vi.hoisted(() => ({
  mockBcrypt: { compare: vi.fn(), hash: vi.fn() },
  mockCrypto: {
    createHash: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({ digest: vi.fn().mockReturnValue('hashed-token') }),
    }),
    randomBytes: vi.fn().mockReturnValue({ toString: vi.fn().mockReturnValue('raw-token-hex') }),
  },
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('bcrypt', () => ({ default: mockBcrypt }))
vi.mock('crypto', () => ({ default: mockCrypto }))
vi.mock('../../config/env', () => ({
  env: { FRONTEND_URL: 'http://localhost:5173', NODE_ENV: 'test' },
}))
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('../../db/schema', () => ({
  users: { id: 'id', email: 'email', isActive: 'isActive' },
  passwordResetTokens: { id: 'id', token: 'token', userId: 'userId', usedAt: 'usedAt', expiresAt: 'expiresAt' },
  refreshTokens: { id: 'id', userId: 'userId', isRevoked: 'isRevoked' },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn(() => ({ type: 'isNull' })),
}))
vi.mock('../platform-settings.service', () => ({
  getSettingsMap: vi.fn().mockResolvedValue({ app_name: 'Test', password_reset_expiry_minutes: '60' }),
}))
vi.mock('../../providers/email', () => ({
  getEmailProvider: vi.fn().mockReturnValue({ send: mockEmailSend }),
}))
vi.mock('../../emails', () => ({
  buildPasswordResetEmail: vi.fn().mockReturnValue({ subject: 's', text: 't', html: 'h' }),
}))

// DB mock with transaction
const mockTxUpdateChain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis() }
const mockTxInsertChain = { values: vi.fn().mockReturnThis() }

vi.mock('../../db', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      passwordResetTokens: { findFirst: vi.fn() },
    },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        update: vi.fn(() => mockTxUpdateChain),
        insert: vi.fn(() => mockTxInsertChain),
      })
    }),
  },
}))

import { requestPasswordReset, resetPassword } from '../password-reset.service'
import { db } from '../../db'

const mockUser = {
  id: 'u1', name: 'Test', email: 'test@test.com', isActive: true, passwordHash: 'hashed-pw',
}

describe('requestPasswordReset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmailSend.mockResolvedValue(undefined)
  })

  it('generates SHA256 token and saves to database with expiry', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    await requestPasswordReset('test@test.com')
    expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32)
    expect(mockCrypto.createHash).toHaveBeenCalledWith('sha256')
    expect(mockTxInsertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', token: 'hashed-token',
    }))
  })

  it('sends email with reset link', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    await requestPasswordReset('test@test.com')
    expect(mockEmailSend).toHaveBeenCalled()
  })

  it('does not throw error for non-existent email (security)', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(null as never)
    await expect(requestPasswordReset('nope@test.com')).resolves.toBeUndefined()
    expect(mockEmailSend).not.toHaveBeenCalled()
  })

  it('silently handles email sending error', async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockEmailSend.mockRejectedValueOnce(new Error('smtp error'))
    await expect(requestPasswordReset('test@test.com')).resolves.toBeUndefined()
  })
})

describe('resetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const futureDate = new Date()
  futureDate.setHours(futureDate.getHours() + 1)

  it('resets password for valid and non-expired token', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: null, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(false)
    mockBcrypt.hash.mockResolvedValue('new-hash')

    await expect(resetPassword('raw-token', 'new-pw')).resolves.toBeUndefined()
    expect(mockBcrypt.hash).toHaveBeenCalledWith('new-pw', 12)
  })

  it('revokes all user refresh tokens', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: null, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(false)
    mockBcrypt.hash.mockResolvedValue('new-hash')

    await resetPassword('raw-token', 'new-pw')
    expect(mockTxUpdateChain.set).toHaveBeenCalledWith({ isRevoked: true })
  })

  it('throws 400 for already used token', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: new Date(), expiresAt: futureDate,
    } as never)
    await expect(resetPassword('raw-token', 'new-pw')).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 for expired token', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: null, expiresAt: new Date('2020-01-01'),
    } as never)
    await expect(resetPassword('raw-token', 'new-pw')).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 for new password same as current', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: null, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUser as never)
    mockBcrypt.compare.mockResolvedValue(true)
    await expect(resetPassword('raw-token', 'same-pw')).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 for inactive user', async () => {
    vi.mocked(db.query.passwordResetTokens.findFirst).mockResolvedValue({
      id: 'prt1', userId: 'u1', token: 'hashed-token', usedAt: null, expiresAt: futureDate,
    } as never)
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ ...mockUser, isActive: false } as never)
    await expect(resetPassword('raw-token', 'new-pw')).rejects.toMatchObject({ status: 400 })
  })
})
