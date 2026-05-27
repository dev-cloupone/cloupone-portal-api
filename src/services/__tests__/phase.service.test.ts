import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn((col: unknown) => ({ type: 'asc', col })),
  sum: vi.fn(() => 'sum'),
  sql: vi.fn(),
  count: vi.fn(() => 'count'),
  ne: vi.fn(),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  projectPhases: {
    id: 'id', projectId: 'projectId', name: 'name', description: 'description',
    order: 'order', isActive: 'isActive', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
  projectSubphases: {
    id: 'id', phaseId: 'phaseId', name: 'name', description: 'description',
    estimatedHours: 'estimatedHours', order: 'order', status: 'status',
    isActive: 'isActive', endDate: 'endDate',
  },
  timeEntries: { id: 'id', subphaseId: 'subphaseId', hours: 'hours' },
  projects: { id: 'id', name: 'name', isActive: 'isActive', clientId: 'clientId' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
}))

vi.mock('../../db/schema/clients', () => ({
  clients: { id: 'id', companyName: 'companyName' },
}))

vi.mock('../../utils/project-access', () => ({
  assertUserHasProjectAccess: vi.fn().mockResolvedValue(undefined),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

const mockTransaction = {
  insert: vi.fn(),
  select: vi.fn(),
}

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
  createPhase, reorderPhases, listPhases, clonePhases,
  updatePhase, deactivatePhase, getPhasesDashboard, listClonableProjects,
} from '../phase.service'
import { db } from '../../db'
import { assertUserHasProjectAccess } from '../../utils/project-access'

const mockPhase = {
  id: 'ph1', projectId: 'p1', name: 'Fase 1', description: 'Desc',
  order: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(),
}

const mockSubphase = {
  id: 'sp1', phaseId: 'ph1', name: 'Subfase 1', description: 'Desc',
  estimatedHours: '40', order: 0, status: 'planned', isActive: true,
  startDate: null, endDate: null, createdAt: new Date(), updatedAt: new Date(),
}

describe('createPhase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates phase with auto-calculated order (max + 1)', async () => {
    // Project exists
    const projectChain = createChain([{ id: 'p1' }])
    // Max order query returns max = 2
    const maxOrderChain = createChain([{ max: 2 }])
    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(maxOrderChain as never)

    const created = { ...mockPhase, order: 3 }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createPhase('p1', { name: 'Fase 1' })
    expect(result).toEqual(created)
    expect(result.order).toBe(3)
    expect(db.insert).toHaveBeenCalled()
  })
})

describe('reorderPhases', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates order of multiple phases in batch', async () => {
    const updateChain = createChain([])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await reorderPhases('p1', ['ph3', 'ph1', 'ph2'])
    expect(result).toEqual({ success: true })
    // Called once per phase id
    expect(db.update).toHaveBeenCalledTimes(3)
  })
})

describe('listPhases', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns phases with subphases', async () => {
    // Project exists
    const projectChain = createChain([{ id: 'p1' }])
    // Phases query
    const phasesChain = createChain([mockPhase])
    // Subphases query for the phase
    const subphasesChain = createChain([mockSubphase])
    // Hours sum query
    const hoursChain = createChain([{ total: '10' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)    // project check
      .mockReturnValueOnce(phasesChain as never)      // phases list
      .mockReturnValueOnce(subphasesChain as never)   // subphases for phase
      .mockReturnValueOnce(hoursChain as never)        // hours sum for subphase

    const result = await listPhases('p1')
    expect(result).toHaveLength(1)
    expect(result[0].subphases).toHaveLength(1)
    expect(result[0].subphaseCount).toBe(1)
    expect(result[0].actualHours).toBe(10)
  })
})

describe('clonePhases', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('clones phases from another project', async () => {
    // 1. Target project exists
    const targetChain = createChain([{ id: 'p-target' }])
    // 2. Target has no existing phases
    const noExistingPhasesChain = createChain([])
    // 3. Source phases exist and match
    const sourcePhasesChain = createChain([
      { id: 'ph-src', projectId: 'p-source', name: 'Fase Original', description: 'D', order: 0, isActive: true },
    ])
    // 4. Source subphases validation
    const sourceSubphasesChain = createChain([{ id: 'sp-src' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(targetChain as never)
      .mockReturnValueOnce(noExistingPhasesChain as never)
      .mockReturnValueOnce(sourcePhasesChain as never)
      .mockReturnValueOnce(sourceSubphasesChain as never)

    // Transaction mock
    const newPhase = { id: 'ph-new', projectId: 'p-target', name: 'Fase Original', order: 0 }
    const newSubphase = { id: 'sp-new', phaseId: 'ph-new', name: 'Sub Original', order: 0 }
    const txInsertPhaseChain = createChain([newPhase])
    const txSelectSubphasesChain = createChain([
      { id: 'sp-src', phaseId: 'ph-src', name: 'Sub Original', description: null, estimatedHours: '20', order: 0, isActive: true },
    ])
    const txInsertSubphaseChain = createChain([newSubphase])

    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce(txInsertPhaseChain as never)
        .mockReturnValueOnce(txInsertSubphaseChain as never),
      select: vi.fn().mockReturnValue(txSelectSubphasesChain as never),
    }

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      return fn(tx as never)
    })

    const result = await clonePhases(
      'p-target', 'p-source',
      [{ phaseId: 'ph-src', subphaseIds: ['sp-src'] }],
      'u-admin', 'super_admin',
    )

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('ph-new')
    expect(result[0].subphases).toHaveLength(1)
    expect(db.transaction).toHaveBeenCalled()
  })

  it('throws 404 when target project does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(clonePhases(
      'p-missing', 'p-source',
      [{ phaseId: 'ph1', subphaseIds: ['sp1'] }],
      'u1', 'super_admin',
    )).rejects.toThrow('Projeto não encontrado.')
  })

  it('throws 400 when target project already has active phases', async () => {
    const targetChain = createChain([{ id: 'p-target' }])
    const existingPhasesChain = createChain([{ id: 'ph-existing' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(targetChain as never)
      .mockReturnValueOnce(existingPhasesChain as never)

    await expect(clonePhases(
      'p-target', 'p-source',
      [{ phaseId: 'ph1', subphaseIds: ['sp1'] }],
      'u1', 'super_admin',
    )).rejects.toThrow('O projeto destino já possui fases ativas.')
  })

  it('throws 403 when gestor has no access to source project', async () => {
    const targetChain = createChain([{ id: 'p-target' }])
    const noExistingPhasesChain = createChain([])
    const noAllocationChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(targetChain as never)
      .mockReturnValueOnce(noExistingPhasesChain as never)
      .mockReturnValueOnce(noAllocationChain as never)

    await expect(clonePhases(
      'p-target', 'p-source',
      [{ phaseId: 'ph1', subphaseIds: ['sp1'] }],
      'u-gestor', 'gestor',
    )).rejects.toThrow('Você não tem acesso ao projeto de origem.')
  })

  it('throws 400 when phase ids do not match source project', async () => {
    const targetChain = createChain([{ id: 'p-target' }])
    const noExistingPhasesChain = createChain([])
    // sourcePhases returns fewer than requested
    const sourcePhasesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(targetChain as never)
      .mockReturnValueOnce(noExistingPhasesChain as never)
      .mockReturnValueOnce(sourcePhasesChain as never)

    await expect(clonePhases(
      'p-target', 'p-source',
      [{ phaseId: 'ph-invalid', subphaseIds: ['sp1'] }],
      'u-admin', 'super_admin',
    )).rejects.toThrow('Uma ou mais fases selecionadas não pertencem ao projeto de origem.')
  })

  it('throws 400 when subphase ids do not match source phases', async () => {
    const targetChain = createChain([{ id: 'p-target' }])
    const noExistingPhasesChain = createChain([])
    const sourcePhasesChain = createChain([
      { id: 'ph-src', projectId: 'p-source', name: 'Fase', description: null, order: 0, isActive: true },
    ])
    // Subphase validation returns fewer than requested
    const sourceSubphasesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(targetChain as never)
      .mockReturnValueOnce(noExistingPhasesChain as never)
      .mockReturnValueOnce(sourcePhasesChain as never)
      .mockReturnValueOnce(sourceSubphasesChain as never)

    await expect(clonePhases(
      'p-target', 'p-source',
      [{ phaseId: 'ph-src', subphaseIds: ['sp-invalid'] }],
      'u-admin', 'super_admin',
    )).rejects.toThrow('Uma ou mais subfases selecionadas não pertencem às fases informadas.')
  })
})

describe('listPhases - branches', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when project does not exist', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(listPhases('p-missing')).rejects.toThrow('Projeto não encontrado.')
  })

  it('calls assertUserHasProjectAccess when userId and userRole are provided', async () => {
    const projectChain = createChain([{ id: 'p1' }])
    const phasesChain = createChain([])
    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(phasesChain as never)

    await listPhases('p1', 'u1', 'gestor')
    expect(assertUserHasProjectAccess).toHaveBeenCalledWith('u1', 'gestor', 'p1')
  })

  it('returns empty array when project has no phases', async () => {
    const projectChain = createChain([{ id: 'p1' }])
    const phasesChain = createChain([])
    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(phasesChain as never)

    const result = await listPhases('p1')
    expect(result).toHaveLength(0)
  })

  it('handles subphase with null estimatedHours and null hours total', async () => {
    const projectChain = createChain([{ id: 'p1' }])
    const phasesChain = createChain([mockPhase])
    const subphasesChain = createChain([{ ...mockSubphase, estimatedHours: null }])
    const hoursChain = createChain([{ total: null }])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectChain as never)
      .mockReturnValueOnce(phasesChain as never)
      .mockReturnValueOnce(subphasesChain as never)
      .mockReturnValueOnce(hoursChain as never)

    const result = await listPhases('p1')
    expect(result[0].estimatedHours).toBe(0)
    expect(result[0].actualHours).toBe(0)
    expect(result[0].subphases[0].actualHours).toBe(0)
  })
})

describe('updatePhase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when phase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(updatePhase('ph-missing', { name: 'X' })).rejects.toThrow('Fase não encontrada.')
  })

  it('updates phase fields', async () => {
    const existingChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    vi.mocked(db.select).mockReturnValueOnce(existingChain as never)

    const updated = { ...mockPhase, name: 'Updated' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updatePhase('ph1', { name: 'Updated', description: 'New desc', order: 5 })
    expect(result).toEqual(updated)
    expect(db.update).toHaveBeenCalled()
  })

  it('calls assertUserHasProjectAccess when userId and userRole provided', async () => {
    const existingChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    vi.mocked(db.select).mockReturnValueOnce(existingChain as never)

    const updateChain = createChain([mockPhase])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    await updatePhase('ph1', { name: 'X' }, 'u1', 'gestor')
    expect(assertUserHasProjectAccess).toHaveBeenCalledWith('u1', 'gestor', 'p1')
  })
})

describe('deactivatePhase', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws 404 when phase not found', async () => {
    const emptyChain = createChain([])
    vi.mocked(db.select).mockReturnValueOnce(emptyChain as never)

    await expect(deactivatePhase('ph-missing')).rejects.toThrow('Fase não encontrada.')
  })

  it('sets isActive to false', async () => {
    const existingChain = createChain([{ id: 'ph1', projectId: 'p1' }])
    vi.mocked(db.select).mockReturnValueOnce(existingChain as never)

    const deactivated = { ...mockPhase, isActive: false }
    const updateChain = createChain([deactivated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await deactivatePhase('ph1')
    expect(result.isActive).toBe(false)
  })
})

describe('getPhasesDashboard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns alertSubphases when hours > 80% consumed', async () => {
    const inProgressRow = {
      project_subphases: {
        id: 'sp1', name: 'Sub 1', estimatedHours: '100', status: 'in_progress',
        isActive: true, endDate: null,
      },
      project_phases: { id: 'ph1', name: 'Phase 1', isActive: true },
      projects: { name: 'Project 1' },
    }
    const allInProgressChain = createChain([inProgressRow])
    const hoursChain = createChain([{ total: '90' }])
    const projectSummariesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(allInProgressChain as never) // allInProgress query
      .mockReturnValueOnce(hoursChain as never)          // hours for sp1
      .mockReturnValueOnce(projectSummariesChain as never) // project summaries

    const result = await getPhasesDashboard()
    expect(result.alertSubphases).toHaveLength(1)
    expect(result.alertSubphases[0].percentage).toBe(90)
    expect(result.alertSubphases[0].subphaseName).toBe('Sub 1')
  })

  it('returns overdueSubphases when endDate is past', async () => {
    const inProgressRow = {
      project_subphases: {
        id: 'sp1', name: 'Late Sub', estimatedHours: '100', status: 'in_progress',
        isActive: true, endDate: '2020-01-01',
      },
      project_phases: { id: 'ph1', name: 'Phase 1', isActive: true },
      projects: { name: 'Project 1' },
    }
    const allInProgressChain = createChain([inProgressRow])
    const hoursChain = createChain([{ total: '10' }])
    const projectSummariesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(allInProgressChain as never)
      .mockReturnValueOnce(hoursChain as never)
      .mockReturnValueOnce(projectSummariesChain as never)

    const result = await getPhasesDashboard()
    expect(result.overdueSubphases).toHaveLength(1)
    expect(result.overdueSubphases[0].subphaseName).toBe('Late Sub')
  })

  it('returns project summaries with status counts', async () => {
    const allInProgressChain = createChain([])
    const projectSummariesChain = createChain([
      { projectId: 'p1', projectName: 'Project 1', totalPhases: 2 },
    ])
    const statusCountsChain = createChain([
      { status: 'planned', count: 3 },
      { status: 'in_progress', count: 2 },
      { status: 'completed', count: 1 },
    ])

    vi.mocked(db.select)
      .mockReturnValueOnce(allInProgressChain as never)
      .mockReturnValueOnce(projectSummariesChain as never)
      .mockReturnValueOnce(statusCountsChain as never)

    const result = await getPhasesDashboard()
    expect(result.projectSummaries).toHaveLength(1)
    expect(result.projectSummaries[0].subphases).toEqual({ planned: 3, in_progress: 2, completed: 1 })
  })

  it('handles subphase with zero estimated hours (percentage=0)', async () => {
    const inProgressRow = {
      project_subphases: {
        id: 'sp1', name: 'No Estimate', estimatedHours: '0', status: 'in_progress',
        isActive: true, endDate: null,
      },
      project_phases: { id: 'ph1', name: 'Phase 1', isActive: true },
      projects: { name: 'Project 1' },
    }
    const allInProgressChain = createChain([inProgressRow])
    const hoursChain = createChain([{ total: '10' }])
    const projectSummariesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(allInProgressChain as never)
      .mockReturnValueOnce(hoursChain as never)
      .mockReturnValueOnce(projectSummariesChain as never)

    const result = await getPhasesDashboard()
    expect(result.alertSubphases).toHaveLength(0)
  })

  it('sorts alertSubphases by percentage descending', async () => {
    const rows = [
      {
        project_subphases: { id: 'sp1', name: 'Sub A', estimatedHours: '100', status: 'in_progress', isActive: true, endDate: null },
        project_phases: { id: 'ph1', name: 'Phase 1', isActive: true },
        projects: { name: 'Project 1' },
      },
      {
        project_subphases: { id: 'sp2', name: 'Sub B', estimatedHours: '100', status: 'in_progress', isActive: true, endDate: null },
        project_phases: { id: 'ph1', name: 'Phase 1', isActive: true },
        projects: { name: 'Project 1' },
      },
    ]
    const allInProgressChain = createChain(rows)
    const hours1Chain = createChain([{ total: '85' }])
    const hours2Chain = createChain([{ total: '95' }])
    const projectSummariesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(allInProgressChain as never)
      .mockReturnValueOnce(hours1Chain as never)
      .mockReturnValueOnce(hours2Chain as never)
      .mockReturnValueOnce(projectSummariesChain as never)

    const result = await getPhasesDashboard()
    expect(result.alertSubphases).toHaveLength(2)
    expect(result.alertSubphases[0].percentage).toBe(95)
    expect(result.alertSubphases[1].percentage).toBe(85)
  })
})

describe('listClonableProjects', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns projects with phases for super_admin', async () => {
    const projectsChain = createChain([
      { id: 'p1', name: 'Proj 1', clientName: 'Client A' },
    ])
    const phasesChain = createChain([{ id: 'ph1', name: 'Fase 1' }])
    const subphasesChain = createChain([{ id: 'sp1', name: 'Sub 1', estimatedHours: '40' }])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectsChain as never)
      .mockReturnValueOnce(phasesChain as never)
      .mockReturnValueOnce(subphasesChain as never)

    const result = await listClonableProjects('p-target', 'u-admin', 'super_admin')
    expect(result).toHaveLength(1)
    expect(result[0].phases).toHaveLength(1)
    expect(result[0].phases[0].subphases).toHaveLength(1)
  })

  it('skips projects that have no active phases', async () => {
    const projectsChain = createChain([
      { id: 'p1', name: 'Proj 1', clientName: 'Client A' },
    ])
    const noPhasesChain = createChain([])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectsChain as never)
      .mockReturnValueOnce(noPhasesChain as never)

    const result = await listClonableProjects('p-target', 'u-admin', 'super_admin')
    expect(result).toHaveLength(0)
  })

  it('returns projects filtered by allocation for gestor', async () => {
    const projectsChain = createChain([
      { id: 'p1', name: 'Proj 1', clientName: 'Client A' },
    ])
    const phasesChain = createChain([{ id: 'ph1', name: 'Fase 1' }])
    const subphasesChain = createChain([{ id: 'sp1', name: 'Sub 1', estimatedHours: null }])

    vi.mocked(db.select)
      .mockReturnValueOnce(projectsChain as never)
      .mockReturnValueOnce(phasesChain as never)
      .mockReturnValueOnce(subphasesChain as never)

    const result = await listClonableProjects('p-target', 'u-gestor', 'gestor')
    expect(result).toHaveLength(1)
    expect(result[0].phases[0].subphases[0].estimatedHours).toBeNull()
  })
})
