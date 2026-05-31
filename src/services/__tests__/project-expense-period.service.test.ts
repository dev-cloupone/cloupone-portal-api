import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  between: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  projectExpensePeriods: {
    id: 'id', projectId: 'projectId', weekStart: 'weekStart', weekEnd: 'weekEnd',
    customDays: 'customDays', status: 'status', openedBy: 'openedBy', openedAt: 'openedAt',
    closedBy: 'closedBy', closedAt: 'closedAt', reopenedBy: 'reopenedBy', reopenedAt: 'reopenedAt',
    createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  expenses: {
    id: 'id', projectId: 'projectId', date: 'date', status: 'status',
  },
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'
import {
  openPeriod, closePeriod, reopenPeriod, updatePeriodDays,
} from '../project-expense-period.service'
import { db } from '../../db'

const SUNDAY = '2025-05-25'
const WEEK_END = '2025-05-31'

function makePeriod(overrides: Record<string, unknown> = {}) {
  return {
    id: 'period-1',
    projectId: 'proj-1',
    weekStart: SUNDAY,
    weekEnd: WEEK_END,
    customDays: null,
    status: 'open',
    openedBy: 'user-1',
    openedAt: new Date(),
    closedBy: null,
    closedAt: null,
    reopenedBy: null,
    reopenedAt: null,
    ...overrides,
  }
}

describe('openPeriod', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects weekStart that is not a Sunday', async () => {
    await expect(openPeriod('proj-1', { weekStart: '2025-05-26' }, 'user-1'))
      .rejects.toThrow(AppError)
    await expect(openPeriod('proj-1', { weekStart: '2025-05-26' }, 'user-1'))
      .rejects.toThrow('domingo')
  })

  it('rejects duplicate period for same project and week', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'existing' }]) as never)

    await expect(openPeriod('proj-1', { weekStart: SUNDAY }, 'user-1'))
      .rejects.toThrow(AppError)
    await expect(openPeriod('proj-1', { weekStart: SUNDAY }, 'user-1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('creates period successfully with no customDays', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    const created = makePeriod()
    vi.mocked(db.insert).mockReturnValue(createChain([created]) as never)

    const result = await openPeriod('proj-1', { weekStart: SUNDAY }, 'user-1')
    expect(result).toEqual(created)
    expect(db.insert).toHaveBeenCalled()
  })

  it('rejects customDays outside the week range', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(
      openPeriod('proj-1', { weekStart: SUNDAY, customDays: ['2025-06-02'] }, 'user-1'),
    ).rejects.toThrow('fora do intervalo')
  })
})

describe('closePeriod', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects if period not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(closePeriod('period-1', 'proj-1', 'user-1'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('rejects if period is not open', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod({ status: 'closed' })]) as never)

    await expect(closePeriod('period-1', 'proj-1', 'user-1'))
      .rejects.toThrow('não está aberto')
  })

  it('rejects if there are pending expenses', async () => {
    // First select returns the period, second returns expense count
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([makePeriod()]) as never)
      .mockReturnValueOnce(createChain([{ count: 3 }]) as never)

    await expect(closePeriod('period-1', 'proj-1', 'user-1'))
      .rejects.toThrow('pendentes')
  })

  it('closes period successfully when no pending expenses', async () => {
    const updated = makePeriod({ status: 'closed' })
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([makePeriod()]) as never)
      .mockReturnValueOnce(createChain([{ count: 0 }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await closePeriod('period-1', 'proj-1', 'user-1')
    expect(result).toEqual(updated)
  })
})

describe('reopenPeriod', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects if period is not closed', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod({ status: 'open' })]) as never)

    await expect(reopenPeriod('period-1', 'proj-1', 'user-1'))
      .rejects.toThrow('não está fechado')
  })

  it('reopens period successfully', async () => {
    const updated = makePeriod({ status: 'open', reopenedBy: 'user-1' })
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod({ status: 'closed' })]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await reopenPeriod('period-1', 'proj-1', 'user-1')
    expect(result).toEqual(updated)
  })
})

describe('updatePeriodDays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates customDays successfully', async () => {
    const period = makePeriod({ customDays: ['2025-05-26', '2025-05-27'] })
    const updated = makePeriod({ customDays: ['2025-05-26', '2025-05-27', '2025-05-28', '2025-05-29'] })

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([period]) as never) // find period
      .mockReturnValueOnce(createChain([{ count: 0 }]) as never) // no expenses on removed days (none removed)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await updatePeriodDays(
      'period-1', 'proj-1',
      { customDays: ['2025-05-26', '2025-05-27', '2025-05-28', '2025-05-29'] },
      'user-1',
    )
    expect(result).toEqual(updated)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when period not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(
      updatePeriodDays('period-1', 'proj-1', { customDays: ['2025-05-26'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 404 when period belongs to different project', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod({ projectId: 'other-proj' })]) as never)

    await expect(
      updatePeriodDays('period-1', 'proj-1', { customDays: ['2025-05-26'] }, 'user-1'),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when period is not open', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod({ status: 'closed' })]) as never)

    await expect(
      updatePeriodDays('period-1', 'proj-1', { customDays: ['2025-05-26'] }, 'user-1'),
    ).rejects.toThrow('não está aberto')
  })

  it('throws 400 when customDays are outside week range', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([makePeriod()]) as never)

    await expect(
      updatePeriodDays('period-1', 'proj-1', { customDays: ['2025-06-05'] }, 'user-1'),
    ).rejects.toThrow('fora do intervalo')
  })

  it('throws 400 when removing days that have expenses', async () => {
    // Period has Mon+Tue open, we're removing Tue (keeping only Mon)
    const period = makePeriod({ customDays: ['2025-05-26', '2025-05-27'] })

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([period]) as never) // find period
      .mockReturnValueOnce(createChain([{ count: 1 }]) as never) // expenses exist on removed day

    await expect(
      updatePeriodDays('period-1', 'proj-1', { customDays: ['2025-05-26'] }, 'user-1'),
    ).rejects.toThrow('despesas lançadas')
  })

  it('normalizes to null when all 7 days are selected', async () => {
    const period = makePeriod({ customDays: ['2025-05-26', '2025-05-27'] })
    const allDays = [
      '2025-05-25', '2025-05-26', '2025-05-27', '2025-05-28',
      '2025-05-29', '2025-05-30', '2025-05-31',
    ]
    const updated = makePeriod({ customDays: null })

    vi.mocked(db.select).mockReturnValueOnce(createChain([period]) as never)
    // No removed days check needed since we're going from 2 days to all 7 (only adding)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await updatePeriodDays('period-1', 'proj-1', { customDays: allDays }, 'user-1')
    expect(result).toEqual(updated)
  })

  it('normalizes empty array to null (full week)', async () => {
    const period = makePeriod()
    const updated = makePeriod({ customDays: null })

    vi.mocked(db.select).mockReturnValueOnce(createChain([period]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await updatePeriodDays('period-1', 'proj-1', { customDays: [] }, 'user-1')
    expect(result).toEqual(updated)
  })
})
