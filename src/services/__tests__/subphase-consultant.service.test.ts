import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
}))

vi.mock('../../db/schema', () => ({
  subphaseConsultants: {
    id: 'id', subphaseId: 'subphaseId', userId: 'userId',
    estimatedHours: 'estimatedHours', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  projectSubphases: {
    id: 'id', phaseId: 'phaseId', name: 'name',
    isActive: 'isActive', estimatedHours: 'estimatedHours',
  },
  projectPhases: {
    id: 'id', projectId: 'projectId',
  },
  projectAllocations: {
    id: 'id', projectId: 'projectId', userId: 'userId',
  },
  users: { id: 'id', name: 'name', email: 'email' },
}))

vi.mock('../../utils/project-access', () => ({
  assertUserHasProjectAccess: vi.fn().mockResolvedValue(undefined),
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
  addConsultant, updateConsultantHours, removeConsultant, loadConsultants, listConsultants,
} from '../subphase-consultant.service'
import { db } from '../../db'
import { assertUserHasProjectAccess } from '../../utils/project-access'

const mockLink = {
  id: 'sc1', subphaseId: 'sp1', userId: 'u-consultor',
  estimatedHours: '20', createdAt: new Date(), updatedAt: new Date(),
}

describe('addConsultant', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('links consultant to subphase', async () => {
    // 1. Subphase exists
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph1' }])
    // 2. Phase exists (to get projectId)
    const phaseChain = createChain([{ projectId: 'p1' }])
    // 3. Allocation exists (consultant is allocated to project)
    const allocationChain = createChain([{ id: 'a1' }])
    // 4. No existing link (not already linked)
    const noExistingChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)     // subphase lookup
      .mockReturnValueOnce(phaseChain as never)        // phase lookup
      .mockReturnValueOnce(allocationChain as never)   // allocation check
      .mockReturnValueOnce(noExistingChain as never)   // no existing link

    const insertChain = createChain([mockLink])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await addConsultant('sp1', 'u-consultor', 20)
    expect(result).toEqual(mockLink)
    expect(db.insert).toHaveBeenCalled()
  })

  it('throws 409 for duplicate link', async () => {
    // 1. Subphase exists
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph1' }])
    // 2. Phase exists
    const phaseChain = createChain([{ projectId: 'p1' }])
    // 3. Allocation exists
    const allocationChain = createChain([{ id: 'a1' }])
    // 4. Existing link found (already linked)
    const existingChain = createChain([{ id: 'sc-existing' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(existingChain as never)

    await expect(addConsultant('sp1', 'u-consultor', 20)).rejects.toThrow('Consultor já está vinculado a esta subfase.')
  })
})

describe('updateConsultantHours', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates consultant estimated hours in the subphase', async () => {
    // Existing link
    const existingChain = createChain([{ id: 'sc1' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const updated = { ...mockLink, estimatedHours: '30' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateConsultantHours('sp1', 'u-consultor', 30)
    expect(result.estimatedHours).toBe('30')
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when link not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(updateConsultantHours('sp1', 'u-missing', 30))
      .rejects.toThrow('Vínculo não encontrado.')
  })
})

describe('addConsultant - validations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when subphase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(addConsultant('sp-missing', 'u1'))
      .rejects.toThrow('Subfase não encontrada.')
  })

  it('throws 404 when phase not found', async () => {
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph-missing' }])
    const emptyPhaseChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)
      .mockReturnValueOnce(emptyPhaseChain as never)

    await expect(addConsultant('sp1', 'u1'))
      .rejects.toThrow('Fase não encontrada.')
  })

  it('throws 400 when consultant is not allocated to project', async () => {
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph1' }])
    const phaseChain = createChain([{ projectId: 'p1' }])
    const noAllocationChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(noAllocationChain as never)

    await expect(addConsultant('sp1', 'u-not-allocated'))
      .rejects.toThrow('Consultor não está alocado neste projeto.')
  })

  it('calls assertUserHasProjectAccess when requestUserId and requestUserRole are provided', async () => {
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph1' }])
    const phaseChain = createChain([{ projectId: 'p1' }])
    const allocationChain = createChain([{ id: 'a1' }])
    const noExistingChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(noExistingChain as never)

    const insertChain = createChain([mockLink])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    await addConsultant('sp1', 'u-consultor', 20, 'u-gestor', 'gestor')
    expect(assertUserHasProjectAccess).toHaveBeenCalledWith('u-gestor', 'gestor', 'p1')
  })

  it('creates link without estimatedHours when not provided', async () => {
    const subphaseChain = createChain([{ id: 'sp1', phaseId: 'ph1' }])
    const phaseChain = createChain([{ projectId: 'p1' }])
    const allocationChain = createChain([{ id: 'a1' }])
    const noExistingChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(subphaseChain as never)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(allocationChain as never)
      .mockReturnValueOnce(noExistingChain as never)

    const created = { ...mockLink, estimatedHours: undefined }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await addConsultant('sp1', 'u-consultor')
    expect(result).toEqual(created)
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('removeConsultant', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('removes consultant link', async () => {
    const existingChain = createChain([{ id: 'sc1' }])
    vi.mocked(db.select).mockReturnValue(existingChain as never)

    const deleteChain = createChain([])
    vi.mocked(db.delete).mockReturnValue(deleteChain as never)

    const result = await removeConsultant('sp1', 'u-consultor')
    expect(result).toEqual({ success: true })
    expect(db.delete).toHaveBeenCalled()
  })

  it('throws 404 when link not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValue(emptyChain as never)

    await expect(removeConsultant('sp1', 'u-missing'))
      .rejects.toThrow('Vínculo não encontrado.')
  })
})

describe('loadConsultants', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when phase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(loadConsultants('ph-missing'))
      .rejects.toThrow('Fase não encontrada.')
  })

  it('returns loaded: 0 when no allocations exist', async () => {
    const phaseChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    const noAllocationsChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(noAllocationsChain as never)

    const result = await loadConsultants('ph1')
    expect(result).toEqual({ loaded: 0 })
  })

  it('distributes hours equally among consultants', async () => {
    const phaseChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    const allocationsChain = createChain([{ userId: 'u1' }, { userId: 'u2' }])
    const subphasesChain = createChain([
      { id: 'sp1', phaseId: 'ph1', name: 'Sub 1', estimatedHours: '100', isActive: true },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(allocationsChain as never)
      .mockReturnValueOnce(subphasesChain as never)

    const deleteChain = createChain([])
    vi.mocked(db.delete).mockReturnValue(deleteChain as never)

    const insertChain = createChain([])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await loadConsultants('ph1')
    expect(result).toEqual({ loaded: 2 })
    expect(db.delete).toHaveBeenCalledTimes(1) // once per subphase
    expect(db.insert).toHaveBeenCalledTimes(2) // once per consultant per subphase
  })

  it('loads consultants across multiple subphases', async () => {
    const phaseChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    const allocationsChain = createChain([{ userId: 'u1' }])
    const subphasesChain = createChain([
      { id: 'sp1', phaseId: 'ph1', name: 'Sub 1', estimatedHours: '40', isActive: true },
      { id: 'sp2', phaseId: 'ph1', name: 'Sub 2', estimatedHours: null, isActive: true },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(allocationsChain as never)
      .mockReturnValueOnce(subphasesChain as never)

    const deleteChain = createChain([])
    vi.mocked(db.delete).mockReturnValue(deleteChain as never)

    const insertChain = createChain([])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await loadConsultants('ph1')
    expect(result).toEqual({ loaded: 2 })
    expect(db.delete).toHaveBeenCalledTimes(2) // once per subphase
    expect(db.insert).toHaveBeenCalledTimes(2) // once per consultant per subphase
  })

  it('calls assertUserHasProjectAccess when requestUserId and requestUserRole provided', async () => {
    const phaseChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    const noAllocationsChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(phaseChain as never)
      .mockReturnValueOnce(noAllocationsChain as never)

    await loadConsultants('ph1', 'u-gestor', 'gestor')
    expect(assertUserHasProjectAccess).toHaveBeenCalledWith('u-gestor', 'gestor', 'p1')
  })
})

describe('listConsultants', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns consultants for a subphase', async () => {
    const consultantsChain = createChain([
      { id: 'sc1', subphaseId: 'sp1', userId: 'u1', userName: 'User 1', userEmail: 'u1@test.com', estimatedHours: '20', createdAt: new Date() },
    ])
    vi.mocked(db.select).mockReturnValue(consultantsChain as never)

    const result = await listConsultants('sp1')
    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe('u1')
  })
})
