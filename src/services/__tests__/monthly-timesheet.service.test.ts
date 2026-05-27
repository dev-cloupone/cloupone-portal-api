import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  count: vi.fn(),
  lt: vi.fn(),
  desc: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  monthlyTimesheets: { id: 'id', userId: 'userId', year: 'year', month: 'month', status: 'status', approvedAt: 'approvedAt', approvedById: 'approvedById', reopenedAt: 'reopenedAt', reopenedById: 'reopenedById', reopenReason: 'reopenReason', escalatedAt: 'escalatedAt', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  timeEntries: { userId: 'userId', date: 'date', hours: 'hours' },
  users: { id: 'id', name: 'name' },
  projects: { id: 'id', name: 'name' },
  tickets: { id: 'id', code: 'code' },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

import { getOrCreate, isMonthOpen, approve, reopen, list, runEscalation } from '../monthly-timesheet.service'
import { db } from '../../db'

const mockTimesheet = {
  id: 'ts1', userId: 'u1', year: 2024, month: 6, status: 'open' as const,
  approvedAt: null, approvedById: null, reopenedAt: null, reopenedById: null,
  reopenReason: null, escalatedAt: null, createdAt: new Date(), updatedAt: new Date(),
}

describe('getOrCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns existing timesheet without creating new one', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([mockTimesheet]) as never)
    const result = await getOrCreate('u1', 2024, 6)
    expect(result).toEqual(mockTimesheet)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('creates new timesheet when none exists', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    vi.mocked(db.insert).mockReturnValue(createChain([{ ...mockTimesheet, id: 'ts-new' }]) as never)
    const result = await getOrCreate('u1', 2024, 6)
    expect(result.id).toBe('ts-new')
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('isMonthOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when timesheet does not exist', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    expect(await isMonthOpen('u1', 2024, 6)).toBe(true)
  })

  it('returns true when status is open', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ status: 'open' }]) as never)
    expect(await isMonthOpen('u1', 2024, 6)).toBe(true)
  })

  it('returns true when status is reopened', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ status: 'reopened' }]) as never)
    expect(await isMonthOpen('u1', 2024, 6)).toBe(true)
  })

  it('returns false when status is approved', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ status: 'approved' }]) as never)
    expect(await isMonthOpen('u1', 2024, 6)).toBe(false)
  })
})

describe('approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('changes status to approved', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([mockTimesheet]) as never)
    const updateChain = createChain([{ ...mockTimesheet, status: 'approved' }])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await approve('u1', 2024, 6, 'admin1')
    expect(result.status).toBe('approved')
  })

  it('records approvedById', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([mockTimesheet]) as never)
    const updateChain = createChain([{ ...mockTimesheet, status: 'approved', approvedById: 'admin1' }])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await approve('u1', 2024, 6, 'admin1')
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'approved',
      approvedById: 'admin1',
    }))
  })

  it('throws error when timesheet is already approved', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ ...mockTimesheet, status: 'approved' }]) as never)
    await expect(approve('u1', 2024, 6, 'admin1')).rejects.toThrow(AppError)
  })
})

describe('reopen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('changes status to reopened', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ ...mockTimesheet, status: 'approved' }]) as never)
    const updateChain = createChain([{ ...mockTimesheet, status: 'reopened' }])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await reopen('u1', 2024, 6, 'admin1', 'Correcao necessaria')
    expect(result.status).toBe('reopened')
  })

  it('records reopen reason', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ ...mockTimesheet, status: 'approved' }]) as never)
    const updateChain = createChain([{ ...mockTimesheet, status: 'reopened' }])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await reopen('u1', 2024, 6, 'admin1', 'Correcao necessaria')
    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'reopened',
      reopenReason: 'Correcao necessaria',
    }))
  })

  it('throws error when timesheet is not approved', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([mockTimesheet]) as never) // status: open
    await expect(reopen('u1', 2024, 6, 'admin1', 'reason')).rejects.toThrow(AppError)
  })
})

describe('list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns paginated list with filters', async () => {
    let callN = 0
    vi.mocked(db.select).mockImplementation(() => {
      callN++
      if (callN === 1) return createChain([{ total: 5 }]) as never
      return createChain([mockTimesheet]) as never
    })

    const result = await list({ page: 1, limit: 10 })
    expect(result.data).toBeDefined()
    expect(result.meta).toBeDefined()
  })
})

describe('runEscalation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('only runs after day 5 of the current month', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 5, 3)) // June 3, day < 5

    const result = await runEscalation()
    expect(result.escalated).toBe(0)

    vi.useRealTimers()
  })

  it('escalates open timesheets from past months', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 5, 10)) // June 10, day >= 5

    const timesheets = [{ id: 'ts1', userId: 'u1', year: 2024, month: 5 }]
    vi.mocked(db.select).mockReturnValue(createChain(timesheets) as never)
    const updateChain = createChain()
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await runEscalation()
    expect(result.escalated).toBe(1)
    expect(db.update).toHaveBeenCalled()

    vi.useRealTimers()
  })
})
