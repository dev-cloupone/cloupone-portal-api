import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../app-error'

// Mock db before importing the module under test
vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
  },
}))

vi.mock('../../db/schema', () => ({
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  projects: { id: 'id', clientId: 'clientId' },
}))

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
}))

import { assertUserHasProjectAccess } from '../project-access'
import { db } from '../../db'

function mockSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  }
  vi.mocked(db.select).mockReturnValue(chain as never)
  return chain
}

describe('assertUserHasProjectAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows unrestricted access for super_admin', async () => {
    await expect(
      assertUserHasProjectAccess('user1', 'super_admin', 'proj1')
    ).resolves.toBeUndefined()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('allows access for gestor with project allocation', async () => {
    mockSelectChain([{ id: 'alloc1' }])
    await expect(
      assertUserHasProjectAccess('user1', 'gestor', 'proj1')
    ).resolves.toBeUndefined()
  })

  it('allows access for consultor with project allocation', async () => {
    mockSelectChain([{ id: 'alloc1' }])
    await expect(
      assertUserHasProjectAccess('user1', 'consultor', 'proj1')
    ).resolves.toBeUndefined()
  })

  it('allows access for client when project belongs to their clientId', async () => {
    mockSelectChain([{ clientId: 'client1' }])
    await expect(
      assertUserHasProjectAccess('user1', 'client', 'proj1', 'client1')
    ).resolves.toBeUndefined()
  })

  it('throws AppError 403 for gestor without allocation', async () => {
    mockSelectChain([])
    await expect(
      assertUserHasProjectAccess('user1', 'gestor', 'proj1')
    ).rejects.toThrow(AppError)
    await expect(
      assertUserHasProjectAccess('user1', 'gestor', 'proj1')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws AppError 403 for consultor without allocation', async () => {
    mockSelectChain([])
    await expect(
      assertUserHasProjectAccess('user1', 'consultor', 'proj1')
    ).rejects.toThrow(AppError)
  })

  it('throws AppError 403 for client with different clientId', async () => {
    mockSelectChain([{ clientId: 'other-client' }])
    await expect(
      assertUserHasProjectAccess('user1', 'client', 'proj1', 'client1')
    ).rejects.toThrow(AppError)
  })
})
