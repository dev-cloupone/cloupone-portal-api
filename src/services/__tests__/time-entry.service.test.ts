import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  between: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  sql: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  timeEntries: { id: 'id', userId: 'userId', projectId: 'projectId', date: 'date', startTime: 'startTime', endTime: 'endTime', hours: 'hours', description: 'description', ticketId: 'ticketId', subphaseId: 'subphaseId', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  projects: { id: 'id', name: 'name', clientId: 'clientId' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  users: { id: 'id', name: 'name' },
  clients: { id: 'id', companyName: 'companyName' },
  tickets: { id: 'id', code: 'code', title: 'title', projectId: 'projectId' },
  consultantProfiles: { userId: 'userId', allowOverlappingEntries: 'allowOverlappingEntries' },
  monthlyTimesheets: { id: 'id', userId: 'userId', year: 'year', month: 'month', status: 'status' },
  projectSubphases: { id: 'id', phaseId: 'phaseId', name: 'name', status: 'status', estimatedHours: 'estimatedHours', isActive: 'isActive' },
  projectPhases: { id: 'id', projectId: 'projectId' },
  subphaseConsultants: { id: 'id', subphaseId: 'subphaseId', userId: 'userId' },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

const { mockIsMonthOpen, mockGetOrCreate, mockGetIfExists } = vi.hoisted(() => ({
  mockIsMonthOpen: vi.fn().mockResolvedValue(true),
  mockGetOrCreate: vi.fn().mockResolvedValue({ id: 'ts1', status: 'open' }),
  mockGetIfExists: vi.fn().mockResolvedValue(null),
}))

vi.mock('../monthly-timesheet.service', () => ({
  isMonthOpen: mockIsMonthOpen,
  getOrCreate: mockGetOrCreate,
  getIfExists: mockGetIfExists,
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  getMonthEntries, getWeekEntries, upsertTimeEntry, deleteTimeEntry,
  listForView, listTimeEntries, listSubphaseTimeEntries, listPhaseTimeEntries,
} from '../time-entry.service'
import { db } from '../../db'

describe('getMonthEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIfExists.mockResolvedValue(null)
  })

  it('returns month entries with hour totals', async () => {
    const entries = [
      { id: 'e1', hours: '4.00' },
      { id: 'e2', hours: '3.50' },
    ]
    vi.mocked(db.select).mockReturnValue(createChain(entries) as never)

    const result = await getMonthEntries('u1', '2024-06')
    expect(result.month).toBe('2024-06')
    expect(result.totalHours).toBe(7.5)
    expect(result.entries).toHaveLength(2)
  })

  it('returns working days and hour target', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getMonthEntries('u1', '2024-06')
    // June 2024 has 20 working days
    expect(result.workingDays).toBe(20)
    expect(result.targetHours).toBe(160)
  })

  it('filters by userId and month period', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await getMonthEntries('u1', '2024-01')
    expect(db.select).toHaveBeenCalled()
  })
})

describe('upsertTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMonthOpen.mockResolvedValue(true)
    mockGetOrCreate.mockResolvedValue({ id: 'ts1', status: 'open' })
  })

  it('creates new entry with valid data', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      // 1: allocation, 2: subphase, 3: subphaseConsultant link, 4: consultantProfile, 5: overlap
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 4) return createChain([{ allowOverlappingEntries: false }]) as never
      return createChain([]) as never // no overlap
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'new-entry', hours: '1.00' }]) as never)

    const result = await upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10', startTime: '08:00', endTime: '09:00',
      subphaseId: 'sp1',
    })
    expect(result).toBeDefined()
    expect(result.id).toBe('new-entry')
  })

  it('throws error when month is approved (closed)', async () => {
    mockIsMonthOpen.mockResolvedValue(false)
    // Allocation check passes first
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'alloc1' }]) as never)

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10', startTime: '08:00', endTime: '09:00',
      subphaseId: 'sp1',
    })).rejects.toThrow(AppError)
  })

  it('validates consultant allocation on project', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never) // no allocation

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10', startTime: '08:00', endTime: '09:00',
      subphaseId: 'sp1',
    })).rejects.toThrow(AppError)
  })

  it('rounds times to 5 minutes', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 4) return createChain([{ allowOverlappingEntries: true }]) as never
      return createChain([]) as never
    })
    const insertChain = createChain([{ id: 'new-entry' }])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    // 08:32 rounds to 08:30, 09:33 rounds to 09:35
    await upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10', startTime: '08:32', endTime: '09:33',
      subphaseId: 'sp1',
    })

    const valuesCall = insertChain.values.mock.calls[0][0]
    expect(valuesCall.startTime).toBe('08:30')
    expect(valuesCall.endTime).toBe('09:35')
  })
})

describe('deleteTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMonthOpen.mockResolvedValue(true)
  })

  it('deletes own user entry', async () => {
    const entry = { id: 'e1', userId: 'u1', date: '2024-06-10' }
    vi.mocked(db.select).mockReturnValue(createChain([entry]) as never)
    vi.mocked(db.delete).mockReturnValue(createChain() as never)

    await expect(deleteTimeEntry('e1', 'u1')).resolves.toBeUndefined()
    expect(db.delete).toHaveBeenCalled()
  })

  it('throws 404 for non-existent entry', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(deleteTimeEntry('e999', 'u1')).rejects.toMatchObject({ status: 404 })
  })

  it('throws 403 for another user entry', async () => {
    const entry = { id: 'e1', userId: 'other-user', date: '2024-06-10' }
    vi.mocked(db.select).mockReturnValue(createChain([entry]) as never)
    await expect(deleteTimeEntry('e1', 'u1')).rejects.toMatchObject({ status: 403 })
  })

  it('throws 400 when month is closed', async () => {
    const entry = { id: 'e1', userId: 'u1', date: '2024-06-10' }
    vi.mocked(db.select).mockReturnValue(createChain([entry]) as never)
    mockIsMonthOpen.mockResolvedValue(false)

    await expect(deleteTimeEntry('e1', 'u1')).rejects.toMatchObject({ status: 400 })
  })
})

describe('getMonthEntries - timesheet branch', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns monthlyTimesheet info when timesheet exists', async () => {
    mockGetIfExists.mockResolvedValue({
      id: 'ts1', status: 'approved', approvedAt: '2024-07-01', reopenReason: null,
    })
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '2.00' }]) as never)

    const result = await getMonthEntries('u1', '2024-06')
    expect(result.monthlyTimesheet).toEqual({
      id: 'ts1', status: 'approved', approvedAt: '2024-07-01', reopenReason: null,
    })
  })

  it('returns null monthlyTimesheet when no timesheet exists', async () => {
    mockGetIfExists.mockResolvedValue(null)
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getMonthEntries('u1', '2024-06')
    expect(result.monthlyTimesheet).toBeNull()
  })
})

describe('getWeekEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns entries for a week with totals', async () => {
    const entries = [
      { id: 'e1', hours: '4.00' },
      { id: 'e2', hours: '2.50' },
    ]
    vi.mocked(db.select).mockReturnValue(createChain(entries) as never)

    const result = await getWeekEntries('u1', '2024-06-10')
    expect(result.weekStartDate).toBe('2024-06-10')
    expect(result.totalHours).toBe(6.5)
    expect(result.targetHours).toBe(40)
    expect(result.entries).toHaveLength(2)
  })

  it('returns zero hours for empty week', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getWeekEntries('u1', '2024-06-10')
    expect(result.totalHours).toBe(0)
    expect(result.entries).toHaveLength(0)
  })
})

describe('upsertTimeEntry - additional branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMonthOpen.mockResolvedValue(true)
    mockGetOrCreate.mockResolvedValue({ id: 'ts1', status: 'open' })
  })

  it('throws 400 when start time is after end time', async () => {
    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '10:00', endTime: '09:00', subphaseId: 'sp1',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('throws 400 when duration is less than 15 minutes', async () => {
    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '09:10', subphaseId: 'sp1',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('throws 409 when overlap is detected', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never // subphase
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never // subphaseConsultant
      if (selectCall === 4) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      return createChain([{ id: 'overlap-entry', startTime: '08:00', endTime: '09:30' }]) as never // overlap found
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
    })).rejects.toMatchObject({ status: 409 })
  })

  it('skips overlap check when allowOverlappingEntries is true', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 4) return createChain([{ allowOverlappingEntries: true }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'new-entry' }]) as never)

    const result = await upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
    })
    // Only 4 select calls (no overlap query) instead of 5
    expect(selectCall).toBe(4)
    expect(result.id).toBe('new-entry')
  })

  it('throws 400 when subphaseId is missing for new entry', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      return createChain([]) as never
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00',
    })).rejects.toMatchObject({ status: 400, message: 'Subfase é obrigatória para novos apontamentos.' })
  })

  it('throws 404 when subphase not found', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      return createChain([]) as never // subphase not found
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp-missing',
    })).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when subphase is not in_progress', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      return createChain([{ id: 'sp1', status: 'completed' }]) as never // subphase completed
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
    })).rejects.toMatchObject({ status: 400 })
  })

  it('validates subphase belongs to project for gestor role', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never // subphase
      return createChain([]) as never // subphase NOT in project
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      userRole: 'gestor',
    })).rejects.toMatchObject({ status: 400, message: 'Subfase não pertence ao projeto selecionado.' })
  })

  it('validates subphase belongs to project for super_admin role', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      return createChain([]) as never // subphase NOT in project
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      userRole: 'super_admin',
    })).rejects.toMatchObject({ status: 400, message: 'Subfase não pertence ao projeto selecionado.' })
  })

  it('throws 400 when consultor is not linked to subphase', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      return createChain([]) as never // no link
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
    })).rejects.toMatchObject({ status: 400, message: 'Consultor não está vinculado a esta subfase.' })
  })

  it('validates ticket belongs to project', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      if (selectCall === 2) return createChain([{ projectId: 'other-project' }]) as never // ticket from another project
      return createChain([]) as never
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      ticketId: 't1',
    })).rejects.toMatchObject({ status: 400, message: 'Ticket não pertence ao projeto selecionado.' })
  })

  it('throws 404 when ticket not found', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      return createChain([]) as never // ticket not found
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      ticketId: 't-missing',
    })).rejects.toMatchObject({ status: 404, message: 'Ticket não encontrado.' })
  })

  it('updates existing entry (update path)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never // subphase
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never // subphaseConsultant
      if (selectCall === 4) return createChain([{ id: 'e1', userId: 'u1' }]) as never // existing entry
      if (selectCall === 5) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      return createChain([]) as never // no overlap
    })
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'e1', hours: '2.00' }]) as never)

    const result = await upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '08:00', endTime: '10:00', subphaseId: 'sp1',
      id: 'e1',
    })
    expect(result.id).toBe('e1')
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when updating non-existent entry', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never // allocation
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never // subphase
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never // subphaseConsultant
      return createChain([]) as never // entry not found
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      id: 'e-missing',
    })).rejects.toMatchObject({ status: 404 })
  })

  it('throws 403 when updating entry owned by another user', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'alloc1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sc1' }]) as never
      return createChain([{ id: 'e1', userId: 'other-user' }]) as never // belongs to other user
    })

    await expect(upsertTimeEntry({
      userId: 'u1', projectId: 'p1', date: '2024-06-10',
      startTime: '09:00', endTime: '10:00', subphaseId: 'sp1',
      id: 'e1',
    })).rejects.toMatchObject({ status: 403 })
  })
})

describe('listForView', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('scopes entries to own user for consultor role', async () => {
    const entries = [{ id: 'e1', hours: '3.00' }]
    vi.mocked(db.select).mockReturnValue(createChain(entries) as never)

    const result = await listForView({ month: '2024-06' }, 'u1', 'consultor')
    expect(result.entries).toHaveLength(1)
    expect(result.totalHours).toBe('3.00')
  })

  it('returns empty when gestor has no allocated projects', async () => {
    // First select = getGestorProjectIds returns empty
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await listForView({ month: '2024-06' }, 'u1', 'gestor')
    expect(result.entries).toEqual([])
    expect(result.totalHours).toBe('0.00')
  })

  it('scopes to allocated projects for gestor with projects', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ projectId: 'p1' }, { projectId: 'p2' }]) as never // gestor projects
      return createChain([{ id: 'e1', hours: '5.00' }]) as never // entries
    })

    const result = await listForView({ month: '2024-06' }, 'u1', 'gestor')
    expect(result.entries).toHaveLength(1)
    expect(result.totalHours).toBe('5.00')
  })

  it('filters by consultantId for gestor', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ projectId: 'p1' }]) as never
      return createChain([{ id: 'e1', hours: '4.00' }]) as never
    })

    const result = await listForView({ month: '2024-06', consultantId: 'c1' }, 'u1', 'gestor')
    expect(result.entries).toHaveLength(1)
  })

  it('returns all entries for gestor when all=true', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ projectId: 'p1' }]) as never
      return createChain([
        { id: 'e1', hours: '2.00' },
        { id: 'e2', hours: '3.00' },
      ]) as never
    })

    const result = await listForView({ month: '2024-06', all: true }, 'u1', 'gestor')
    expect(result.entries).toHaveLength(2)
    expect(result.totalHours).toBe('5.00')
  })

  it('returns all entries for super_admin', async () => {
    const entries = [
      { id: 'e1', hours: '1.00' },
      { id: 'e2', hours: '2.00' },
      { id: 'e3', hours: '3.00' },
    ]
    vi.mocked(db.select).mockReturnValue(createChain(entries) as never)

    const result = await listForView({ month: '2024-06', all: true }, 'admin1', 'super_admin')
    expect(result.entries).toHaveLength(3)
    expect(result.totalHours).toBe('6.00')
  })

  it('filters by consultantId for super_admin', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '8.00' }]) as never)

    const result = await listForView({ month: '2024-06', consultantId: 'c1' }, 'admin1', 'super_admin')
    expect(result.entries).toHaveLength(1)
    expect(result.totalHours).toBe('8.00')
  })

  it('defaults to own entries for super_admin without all or consultantId', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '4.00' }]) as never)

    const result = await listForView({ month: '2024-06' }, 'admin1', 'super_admin')
    expect(result.entries).toHaveLength(1)
  })

  it('applies optional projectId filter', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '2.00' }]) as never)

    const result = await listForView({ month: '2024-06', projectId: 'p1' }, 'u1', 'consultor')
    expect(result.entries).toHaveLength(1)
  })

  it('applies optional subphaseId filter', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '1.00' }]) as never)

    const result = await listForView({ month: '2024-06', subphaseId: 'sp1' }, 'u1', 'consultor')
    expect(result.entries).toHaveLength(1)
  })

  it('applies optional ticketId filter', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'e1', hours: '1.00' }]) as never)

    const result = await listForView({ month: '2024-06', ticketId: 't1' }, 'u1', 'consultor')
    expect(result.entries).toHaveLength(1)
  })
})

describe('listTimeEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns paginated entries with no filters', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'e1' }, { id: 'e2' }]) as never // data
      return createChain([{ total: 2 }]) as never // count
    })

    const result = await listTimeEntries({ page: 1, limit: 20 })
    expect(result.data).toHaveLength(2)
    expect(result.meta).toBeDefined()
  })

  it('applies userId filter', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'e1' }]) as never
      return createChain([{ total: 1 }]) as never
    })

    const result = await listTimeEntries({ page: 1, limit: 20, userId: 'u1' })
    expect(result.data).toHaveLength(1)
  })

  it('applies projectId filter', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'e1' }]) as never
      return createChain([{ total: 1 }]) as never
    })

    const result = await listTimeEntries({ page: 1, limit: 20, projectId: 'p1' })
    expect(result.data).toHaveLength(1)
  })

  it('applies from and to date filters', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      return createChain([{ total: 0 }]) as never
    })

    const result = await listTimeEntries({ page: 1, limit: 20, from: '2024-06-01', to: '2024-06-30' })
    expect(result.data).toHaveLength(0)
  })
})

describe('listSubphaseTimeEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns entries with summary for a subphase', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'e1', hours: '4.00' }]) as never // data
      if (selectCall === 2) return createChain([{ total: 1 }]) as never // count
      if (selectCall === 3) return createChain([{ actualHours: '4.00' }]) as never // summary
      return createChain([{ estimatedHours: '10.00' }]) as never // subphase estimatedHours
    })

    const result = await listSubphaseTimeEntries('sp1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(1)
    expect(result.summary.estimatedHours).toBe(10)
    expect(result.summary.actualHours).toBe(4)
    expect(result.summary.percentComplete).toBe(40)
  })

  it('returns 0% when estimatedHours is 0', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain([{ total: 0 }]) as never
      if (selectCall === 3) return createChain([{ actualHours: '0' }]) as never
      return createChain([{ estimatedHours: null }]) as never // null estimatedHours
    })

    const result = await listSubphaseTimeEntries('sp1', { page: 1, limit: 20 })
    expect(result.summary.percentComplete).toBe(0)
    expect(result.summary.estimatedHours).toBe(0)
  })

  it('applies userId filter', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain([{ total: 0 }]) as never
      if (selectCall === 3) return createChain([{ actualHours: '0' }]) as never
      return createChain([{ estimatedHours: '10.00' }]) as never
    })

    const result = await listSubphaseTimeEntries('sp1', { page: 1, limit: 20, userId: 'u1' })
    expect(result.data).toHaveLength(0)
  })

  it('applies from and to date filters', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain([{ total: 0 }]) as never
      if (selectCall === 3) return createChain([{ actualHours: '0' }]) as never
      return createChain([{ estimatedHours: '8.00' }]) as never
    })

    const result = await listSubphaseTimeEntries('sp1', {
      page: 1, limit: 20, from: '2024-06-01', to: '2024-06-30',
    })
    expect(result.meta).toBeDefined()
  })
})

describe('listPhaseTimeEntries', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns empty when phase has no subphases', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never) // no subphases

    const result = await listPhaseTimeEntries('ph1', { page: 1, limit: 20 })
    expect(result.summary).toEqual({ estimatedHours: 0, actualHours: 0, percentComplete: 0 })
    expect(result.data).toEqual([])
  })

  it('returns entries aggregated across phase subphases', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) {
        // subphases for the phase
        return createChain([
          { id: 'sp1', estimatedHours: '10.00' },
          { id: 'sp2', estimatedHours: '20.00' },
        ]) as never
      }
      if (selectCall === 2) return createChain([{ id: 'e1', hours: '5.00' }]) as never // data
      if (selectCall === 3) return createChain([{ total: 1 }]) as never // count
      return createChain([{ actualHours: '5.00' }]) as never // summary
    })

    const result = await listPhaseTimeEntries('ph1', { page: 1, limit: 20 })
    expect(result.summary.estimatedHours).toBe(30)
    expect(result.summary.actualHours).toBe(5)
    expect(result.summary.percentComplete).toBe(17)
    expect(result.data).toHaveLength(1)
  })

  it('applies optional userId and subphaseId filters', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'sp1', estimatedHours: '8.00' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain([{ total: 0 }]) as never
      return createChain([{ actualHours: '0' }]) as never
    })

    const result = await listPhaseTimeEntries('ph1', {
      page: 1, limit: 20, userId: 'u1', subphaseId: 'sp1',
    })
    expect(result.data).toHaveLength(0)
  })

  it('returns 0% when estimatedHours is 0', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'sp1', estimatedHours: null }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain([{ total: 0 }]) as never
      return createChain([{ actualHours: '0' }]) as never
    })

    const result = await listPhaseTimeEntries('ph1', { page: 1, limit: 20 })
    expect(result.summary.percentComplete).toBe(0)
  })
})
