import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

const { mockBcrypt, mockEmailSend } = vi.hoisted(() => ({
  mockBcrypt: { hash: vi.fn(), compare: vi.fn() },
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('bcrypt', () => ({ default: mockBcrypt }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => 'count'),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
}))

vi.mock('../../db/schema', () => ({
  users: {
    id: 'id', name: 'name', email: 'email', role: 'role',
    isActive: 'isActive', clientId: 'clientId', createdAt: 'createdAt',
    updatedAt: 'updatedAt', passwordHash: 'passwordHash',
  },
}))

vi.mock('../../utils/error-messages', () => ({
  USER: {
    NOT_FOUND: 'Usuário não encontrado.',
    EMAIL_IN_USE: 'Já existe um usuário com este email.',
    CANNOT_DEACTIVATE_SELF: 'Não é possível desativar sua própria conta.',
  },
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: vi.fn((total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit),
  })),
}))

vi.mock('../../config/env', () => ({
  env: { FRONTEND_URL: 'http://localhost:5173' },
}))
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }))
vi.mock('../platform-settings.service', () => ({
  getSettingsMap: vi.fn().mockResolvedValue({ must_change_password_on_create: 'false', app_name: 'Test App' }),
}))
vi.mock('../../providers/email', () => ({
  getEmailProvider: vi.fn().mockReturnValue({ send: mockEmailSend }),
}))
vi.mock('../../emails', () => ({
  buildWelcomeEmail: vi.fn().mockReturnValue({ subject: 's', text: 't', html: 'h' }),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

import { createUser, updateUser, deactivateUser, listUsers } from '../user.service'
import { db } from '../../db'

const mockUser = {
  id: 'u1', name: 'Maria Silva', email: 'maria@test.com',
  role: 'consultor', isActive: true, clientId: null,
  createdAt: new Date(), updatedAt: new Date(),
}

describe('createUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBcrypt.hash.mockResolvedValue('hashed-password')
  })

  it('creates user with hashed password', async () => {
    // No existing user with this email
    const selectChain = createChain([])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const created = { ...mockUser, id: 'u-new' }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createUser({
      name: 'Maria Silva', email: 'maria@test.com', password: 'Senha123!', role: 'consultor',
    })
    expect(result).toEqual(created)
    expect(mockBcrypt.hash).toHaveBeenCalledWith('Senha123!', 12)
    expect(db.insert).toHaveBeenCalled()
  })

  it('throws 409 for duplicate email', async () => {
    const selectChain = createChain([{ id: 'u-existing' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    await expect(
      createUser({ name: 'Outro', email: 'maria@test.com', password: 'Senha123!', role: 'consultor' }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('updateUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates user fields', async () => {
    // First select: existing user found; second select for email check won't happen if no email change
    const selectChain = createChain([{ id: 'u1', role: 'consultor' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const updated = { ...mockUser, name: 'Maria Souza' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateUser('u1', { name: 'Maria Souza' })
    expect(result).toEqual(updated)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when user not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(updateUser('invalid', { name: 'X' })).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 for email taken by another user', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'u1', role: 'consultor' }]) as never) // user exists
      .mockReturnValueOnce(createChain([{ id: 'u-other' }]) as never) // email taken by u-other
    await expect(updateUser('u1', { email: 'taken@test.com' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('deactivateUser', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deactivates user (soft delete)', async () => {
    const selectChain = createChain([{ id: 'u1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const deactivated = { ...mockUser, isActive: false }
    const updateChain = createChain([deactivated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await deactivateUser('u1', 'u-admin')
    expect(result.isActive).toBe(false)
  })

  it('throws 400 for self-deactivation', async () => {
    await expect(deactivateUser('u1', 'u1')).rejects.toMatchObject({ status: 400 })
  })

  it('throws 404 when user not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(deactivateUser('invalid', 'u-admin')).rejects.toMatchObject({ status: 404 })
  })
})

describe('listUsers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns correct pagination', async () => {
    const dataChain = createChain([mockUser])
    const countChain = createChain([{ total: 15 }])
    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listUsers({ page: 1, limit: 10 })
    expect(result.data).toEqual([mockUser])
    expect(result.meta).toEqual({ page: 1, limit: 10, total: 15, totalPages: 2 })
  })
})
