import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => ({ type: 'asc', col })),
  sum: vi.fn(() => 'sum'),
  sql: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  projectSubphases: {
    id: 'id', phaseId: 'phaseId', name: 'name', description: 'description',
    estimatedHours: 'estimatedHours', order: 'order', status: 'status',
    isActive: 'isActive', startDate: 'startDate', businessDays: 'businessDays',
    endDate: 'endDate', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  projectPhases: {
    id: 'id', projectId: 'projectId', name: 'name', order: 'order', isActive: 'isActive',
  },
  subphaseConsultants: {
    id: 'id', subphaseId: 'subphaseId', userId: 'userId', estimatedHours: 'estimatedHours',
  },
  timeEntries: { id: 'id', subphaseId: 'subphaseId', userId: 'userId', hours: 'hours' },
  users: { id: 'id', name: 'name', email: 'email' },
}))

vi.mock('../../utils/business-days', () => ({
  calculateEndDate: vi.fn(() => '2026-06-15'),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  createSubphase, updateSubphaseStatus, listAvailableForTimeEntry,
  updateSubphase, deactivateSubphase, reorderSubphases, listSubphases,
} from '../subphase.service'
import { db } from '../../db'
import { calculateEndDate } from '../../utils/business-days'

const mockSubphase = {
  id: 'sp1', phaseId: 'ph1', name: 'Subfase 1', description: 'Desc',
  estimatedHours: '40', order: 0, status: 'planned', isActive: true,
  startDate: null, businessDays: null, endDate: null,
  createdAt: new Date(), updatedAt: new Date(),
}

describe('createSubphase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates subphase with auto-calculated order', async () => {
    // Phase exists
    const phaseChain = createChain([{ id: 'ph1' }])
    // Max order query
    const maxOrderChain = createChain([{ max: 2 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(maxOrderChain as never)

    const created = { ...mockSubphase, order: 3 }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createSubphase('ph1', { name: 'Subfase 1' })
    expect(result).toEqual(created)
    expect(result.order).toBe(3)
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('updateSubphaseStatus', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('allows planned -> in_progress', async () => {
    // Existing subphase with status 'planned'
    const existingChain = createChain([{ ...mockSubphase, status: 'planned' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, status: 'in_progress' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphaseStatus('sp1', 'in_progress')
    expect(result.status).toBe('in_progress')
    expect(db.update).toHaveBeenCalled()
  })

  it('rejects invalid transition', async () => {
    // Existing subphase with status 'planned'
    const existingChain = createChain([{ ...mockSubphase, status: 'planned' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    await expect(updateSubphaseStatus('sp1', 'completed')).rejects.toThrow(AppError)
    await expect(updateSubphaseStatus('sp1', 'completed')).rejects.toThrow('Transição de status inválida.')
  })
})

describe('listAvailableForTimeEntry', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('consultant sees only subphases where they are allocated', async () => {
    // Consultor query: subphases with inner join on subphaseConsultants
    const subphasesChain = createChain([
      { id: 'sp1', name: 'Subfase 1', phaseId: 'ph1', phaseName: 'Fase 1', estimatedHours: '40', consultantEstimatedHours: '20' },
    ])
    // Hours sum query per subphase
    const hoursChain = createChain([{ total: '10' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphasesChain as never)    // subphases with consultant join
      .mockReturnValueOnce(hoursChain as never)         // actual hours sum

    const result = await listAvailableForTimeEntry('p1', 'u-consultor', 'consultor')
    expect(result).toHaveLength(1)
    expect(result[0].consultantActualHours).toBe(10)
  })

  it('gestor sees all in_progress subphases', async () => {
    const subphasesChain = createChain([
      { id: 'sp1', name: 'Subfase 1', phaseId: 'ph1', phaseName: 'Fase 1', estimatedHours: '40', consultantEstimatedHours: null },
    ])
    const hoursChain = createChain([{ total: '5' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(hoursChain as never)

    const result = await listAvailableForTimeEntry('p1', 'u-gestor', 'gestor')
    expect(result).toHaveLength(1)
    expect(result[0].consultantActualHours).toBe(5)
  })

  it('super_admin sees all in_progress subphases', async () => {
    const subphasesChain = createChain([
      { id: 'sp1', name: 'Subfase 1', phaseId: 'ph1', phaseName: 'Fase 1', estimatedHours: '40', consultantEstimatedHours: null },
    ])
    const hoursChain = createChain([{ total: null }])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(hoursChain as never)

    const result = await listAvailableForTimeEntry('p1', 'u-admin', 'super_admin')
    expect(result).toHaveLength(1)
    expect(result[0].consultantActualHours).toBe(0)
  })

  it('consultant with no hours returns 0 actual', async () => {
    const subphasesChain = createChain([
      { id: 'sp1', name: 'Subfase 1', phaseId: 'ph1', phaseName: 'Fase 1', estimatedHours: '40', consultantEstimatedHours: '20' },
    ])
    const hoursChain = createChain([{ total: null }])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(hoursChain as never)

    const result = await listAvailableForTimeEntry('p1', 'u-consultor', 'consultor')
    expect(result[0].consultantActualHours).toBe(0)
  })
})

describe('createSubphase - business day calculation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calculates endDate when startDate and businessDays provided', async () => {
    const phaseChain = createChain([{ id: 'ph1' }])
    const maxOrderChain = createChain([{ max: 0 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(maxOrderChain as never)

    const created = { ...mockSubphase, startDate: '2026-06-01', businessDays: 10, endDate: '2026-06-15', order: 1 }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createSubphase('ph1', {
      name: 'Sub with dates',
      startDate: '2026-06-01',
      businessDays: 10,
    })

    expect(calculateEndDate).toHaveBeenCalledWith('2026-06-01', 10)
    expect(result.endDate).toBe('2026-06-15')
  })

  it('does not calculate endDate when only startDate is provided', async () => {
    const phaseChain = createChain([{ id: 'ph1' }])
    const maxOrderChain = createChain([{ max: -1 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(maxOrderChain as never)

    const created = { ...mockSubphase, startDate: '2026-06-01', order: 0 }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    await createSubphase('ph1', { name: 'Sub', startDate: '2026-06-01' })
    expect(calculateEndDate).not.toHaveBeenCalled()
  })

  it('throws 404 when phase does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(createSubphase('ph-missing', { name: 'X' }))
      .rejects.toThrow('Fase não encontrada.')
  })

  it('passes estimatedHours as string when provided', async () => {
    const phaseChain = createChain([{ id: 'ph1' }])
    const maxOrderChain = createChain([{ max: -1 }])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(maxOrderChain as never)

    const created = { ...mockSubphase, estimatedHours: '80', order: 0 }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createSubphase('ph1', { name: 'Sub', estimatedHours: 80 })
    expect(result.estimatedHours).toBe('80')
  })
})

describe('updateSubphaseStatus - transitions', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('allows in_progress -> completed', async () => {
    const existingChain = createChain([{ ...mockSubphase, status: 'in_progress' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, status: 'completed' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphaseStatus('sp1', 'completed')
    expect(result.status).toBe('completed')
  })

  it('allows in_progress -> planned', async () => {
    const existingChain = createChain([{ ...mockSubphase, status: 'in_progress' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, status: 'planned' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphaseStatus('sp1', 'planned')
    expect(result.status).toBe('planned')
  })

  it('allows completed -> in_progress', async () => {
    const existingChain = createChain([{ ...mockSubphase, status: 'completed' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, status: 'in_progress' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphaseStatus('sp1', 'in_progress')
    expect(result.status).toBe('in_progress')
  })

  it('allows completed -> planned', async () => {
    const existingChain = createChain([{ ...mockSubphase, status: 'completed' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, status: 'planned' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphaseStatus('sp1', 'planned')
    expect(result.status).toBe('planned')
  })

  it('throws 404 when subphase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(updateSubphaseStatus('sp-missing', 'in_progress'))
      .rejects.toThrow('Subfase não encontrada.')
  })
})

describe('updateSubphase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when subphase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(updateSubphase('sp-missing', { name: 'X' }))
      .rejects.toThrow('Subfase não encontrada.')
  })

  it('recalculates endDate when startDate changes', async () => {
    const existingChain = createChain([{ ...mockSubphase, startDate: '2026-06-01', businessDays: 10 }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, startDate: '2026-07-01', endDate: '2026-06-15' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await updateSubphase('sp1', { startDate: '2026-07-01' })
    expect(calculateEndDate).toHaveBeenCalledWith('2026-07-01', 10)
  })

  it('recalculates endDate when businessDays changes', async () => {
    const existingChain = createChain([{ ...mockSubphase, startDate: '2026-06-01', businessDays: 10 }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, businessDays: 20, endDate: '2026-06-15' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await updateSubphase('sp1', { businessDays: 20 })
    expect(calculateEndDate).toHaveBeenCalledWith('2026-06-01', 20)
  })

  it('updates name and estimatedHours', async () => {
    const existingChain = createChain([mockSubphase])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockSubphase, name: 'New Name', estimatedHours: '80' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateSubphase('sp1', { name: 'New Name', estimatedHours: 80 })
    expect(result.name).toBe('New Name')
  })
})

describe('deactivateSubphase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when subphase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(deactivateSubphase('sp-missing'))
      .rejects.toThrow('Subfase não encontrada.')
  })

  it('sets isActive to false', async () => {
    const existingChain = createChain([{ id: 'sp1' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const deactivated = { ...mockSubphase, isActive: false }
    const updateChain = createChain([deactivated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await deactivateSubphase('sp1')
    expect(result.isActive).toBe(false)
  })
})

describe('reorderSubphases', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates order of multiple subphases', async () => {
    const updateChain = createChain([])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await reorderSubphases('ph1', ['sp3', 'sp1', 'sp2'])
    expect(result).toEqual({ success: true })
    expect(db.update).toHaveBeenCalledTimes(3)
  })
})

describe('listSubphases', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when phase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(listSubphases('ph-missing'))
      .rejects.toThrow('Fase não encontrada.')
  })

  it('returns subphases with consultants and actual hours', async () => {
    const phaseChain = createChain([{ id: 'ph1' }])
    const subphasesChain = createChain([mockSubphase])
    const consultantsChain = createChain([
      { id: 'sc1', userId: 'u1', userName: 'User 1', userEmail: 'u1@test.com', estimatedHours: '20' },
    ])
    const actualByConsultantChain = createChain([{ userId: 'u1', total: '15' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(consultantsChain as never)
      .mockReturnValueOnce(actualByConsultantChain as never)

    const result = await listSubphases('ph1')
    expect(result).toHaveLength(1)
    expect(result[0].actualHours).toBe(15)
    expect(result[0].consultants).toHaveLength(1)
    expect(result[0].consultants[0].actualHours).toBe(15)
  })

  it('returns 0 actual hours when consultant has no time entries', async () => {
    const phaseChain = createChain([{ id: 'ph1' }])
    const subphasesChain = createChain([mockSubphase])
    const consultantsChain = createChain([
      { id: 'sc1', userId: 'u1', userName: 'User 1', userEmail: 'u1@test.com', estimatedHours: '20' },
    ])
    const actualByConsultantChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(consultantsChain as never)
      .mockReturnValueOnce(actualByConsultantChain as never)

    const result = await listSubphases('ph1')
    expect(result[0].actualHours).toBe(0)
    expect(result[0].consultants[0].actualHours).toBe(0)
  })
})
