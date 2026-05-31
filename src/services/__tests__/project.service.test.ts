import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => 'count'),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  projects: {
    id: 'id', name: 'name', description: 'description', clientId: 'clientId',
    status: 'status', billingRate: 'billingRate', budgetHours: 'budgetHours',
    budgetType: 'budgetType', startDate: 'startDate', endDate: 'endDate',
    isActive: 'isActive', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  clients: { id: 'id', companyName: 'companyName' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId', costRate: 'costRate', billingRate: 'billingRate', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  users: { id: 'id', name: 'name', email: 'email' },
  consultantProfiles: { userId: 'userId', hourlyRate: 'hourlyRate' },
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: vi.fn((total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit),
  })),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

import {
  listProjects, createProject, updateProject,
  deactivateProject, addAllocation, removeAllocation,
} from '../project.service'
import { db } from '../../db'

const mockProject = {
  id: 'p1', name: 'Projeto Alpha', description: 'Desc', clientId: 'c1',
  clientName: 'Acme Corp', status: 'active', billingRate: '150',
  budgetHours: 100, budgetType: 'fixed', startDate: null, endDate: null,
  isActive: true, createdAt: new Date(), updatedAt: new Date(),
}

describe('listProjects', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('super_admin sees all projects', async () => {
    const dataChain = createChain([mockProject])
    const countChain = createChain([{ total: 1 }])
    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listProjects({ page: 1, limit: 20, userRole: 'super_admin' })
    expect(result.data).toEqual([mockProject])
    expect(result.meta.total).toBe(1)
  })

  it('returns correct pagination', async () => {
    const dataChain = createChain([mockProject])
    const countChain = createChain([{ total: 25 }])
    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listProjects({ page: 2, limit: 10, userRole: 'super_admin' })
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 })
  })
})

describe('createProject', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates project with valid data', async () => {
    const clientChain = createChain([{ id: 'c1' }])
    vi.mocked(db.select).mockReturnValue(clientChain as never)

    const created = { ...mockProject, id: 'p-new' }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createProject({
      name: 'Projeto Alpha', clientId: 'c1', billingRate: 150,
    })
    expect(result).toEqual(created)
    expect(db.insert).toHaveBeenCalled()
  })

  it('throws 404 when clientId not found', async () => {
    const clientChain = createChain([])
    vi.mocked(db.select).mockReturnValue(clientChain as never)

    await expect(createProject({ name: 'Test', clientId: 'invalid', billingRate: 100 }))
      .rejects.toThrow(AppError)
    await expect(createProject({ name: 'Test', clientId: 'invalid', billingRate: 100 }))
      .rejects.toMatchObject({ status: 404 })
  })
})

describe('updateProject', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates partial fields', async () => {
    const selectChain = createChain([{ id: 'p1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const updated = { ...mockProject, name: 'Projeto Beta' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateProject('p1', { name: 'Projeto Beta' })
    expect(result).toEqual(updated)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when project not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(updateProject('invalid', { name: 'X' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('deactivateProject', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deactivates project (soft delete)', async () => {
    const selectChain = createChain([{ id: 'p1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const deactivated = { ...mockProject, isActive: false }
    const updateChain = createChain([deactivated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await deactivateProject('p1')
    expect(result.isActive).toBe(false)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when project not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(deactivateProject('invalid')).rejects.toMatchObject({ status: 404 })
  })
})

describe('addAllocation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('allocates consultant to project', async () => {
    const allocation = { id: 'a1', projectId: 'p1', userId: 'u1', costRate: '100', billingRate: '150', createdAt: new Date() }

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ hourlyRate: '100' }]) as never)  // consultant profile
      .mockReturnValueOnce(createChain([{ billingRate: '150' }]) as never) // project

    vi.mocked(db.insert).mockReturnValue(createChain([allocation]) as never)

    const result = await addAllocation('p1', 'u1')
    expect(result).toEqual(allocation)
  })

  it('throws 409 for duplicate allocation', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ hourlyRate: '100' }]) as never)
      .mockReturnValueOnce(createChain([{ billingRate: '150' }]) as never)

    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)

    await expect(addAllocation('p1', 'u1')).rejects.toMatchObject({ status: 409 })
  })
})

describe('removeAllocation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('removes consultant allocation', async () => {
    const selectChain = createChain([{ id: 'a1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const deleteChain = createChain([])
    vi.mocked(db.delete).mockReturnValue(deleteChain as never)

    const result = await removeAllocation('p1', 'u1')
    expect(result).toEqual({ success: true })
    expect(db.delete).toHaveBeenCalled()
  })

  it('throws 404 when allocation not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(removeAllocation('p1', 'u-none')).rejects.toMatchObject({ status: 404 })
  })
})
