import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  isNotNull: vi.fn((col: unknown) => ({ type: 'isNotNull', col })),
  ne: vi.fn((_col: unknown, val: unknown) => ({ type: 'ne', val })),
}))

vi.mock('../../db/schema', () => ({
  projects: {
    id: 'id', name: 'name', status: 'status', timesheetLockDays: 'timesheetLockDays',
  },
  projectAllocations: {
    id: 'id', projectId: 'projectId', userId: 'userId',
  },
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'
import {
  isProjectLockedForDate, getLockConfig, setLockDays, getLockStatusForUser,
} from '../timesheet-lock.service'
import { db } from '../../db'
import { ne } from 'drizzle-orm'
import { projects } from '../../db/schema'
import { AppError } from '../../utils/app-error'

describe('isProjectLockedForDate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('retorna locked false quando o projeto nao tem prazo', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: null }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result).toEqual({ locked: false })
  })

  it('retorna locked false quando o projeto nao existe', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result).toEqual({ locked: false })
  })

  it('retorna locked false no ultimo dia do prazo', async () => {
    vi.setSystemTime(new Date('2026-02-05T15:00:00Z')) // hoje = 05/02 em Brasilia
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never) // deadline = 31/01 + 5 = 05/02

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result).toEqual({ locked: false, deadline: '2026-02-05' })
  })

  it('retorna locked true no dia seguinte ao prazo', async () => {
    vi.setSystemTime(new Date('2026-02-06T15:00:00Z')) // hoje = 06/02 em Brasilia
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never) // deadline = 05/02

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result.locked).toBe(true)
    expect(result.deadline).toBe('2026-02-05')
    expect(result.reason).toContain('Contate o administrador')
  })

  it('usa o mes da data do apontamento, nao o mes corrente', async () => {
    vi.setSystemTime(new Date('2026-03-10T15:00:00Z')) // hoje = 10/03, bem depois do prazo de janeiro
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15') // lancamento de janeiro
    expect(result.locked).toBe(true)
    expect(result.deadline).toBe('2026-02-05')
  })

  it('calcula o prazo sobre fevereiro de ano bissexto', async () => {
    vi.setSystemTime(new Date('2028-03-05T15:00:00Z')) // hoje = 05/03/2028
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never) // 2028 e bissexto: 29/02 + 5 = 05/03

    const result = await isProjectLockedForDate('proj-1', '2028-02-15')
    expect(result).toEqual({ locked: false, deadline: '2028-03-05' })
  })

  it('retorna locked false com lockDays zero no ultimo dia do mes', async () => {
    vi.setSystemTime(new Date('2026-01-31T15:00:00Z')) // hoje = 31/01
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 0 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result).toEqual({ locked: false, deadline: '2026-01-31' })
  })

  it('retorna locked true com lockDays zero no dia 1 do mes seguinte', async () => {
    vi.setSystemTime(new Date('2026-02-01T15:00:00Z')) // hoje = 01/02
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 0 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15')
    expect(result.locked).toBe(true)
    expect(result.deadline).toBe('2026-01-31')
  })
})

describe('getLockConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('retorna lockDays do projeto', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never)

    const result = await getLockConfig('proj-1')
    expect(result).toEqual({ lockDays: 5 })
  })

  it('lanca 404 quando o projeto nao existe', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(getLockConfig('proj-1')).rejects.toThrow(AppError)
    await expect(getLockConfig('proj-1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('setLockDays', () => {
  beforeEach(() => vi.clearAllMocks())

  it('atualiza lockDays do projeto', async () => {
    vi.mocked(db.update).mockReturnValue(createChain([{ lockDays: 10 }]) as never)

    const result = await setLockDays('proj-1', 10)
    expect(result).toEqual({ lockDays: 10 })
  })

  it('aceita null para limpar o prazo', async () => {
    vi.mocked(db.update).mockReturnValue(createChain([{ lockDays: null }]) as never)

    const result = await setLockDays('proj-1', null)
    expect(result).toEqual({ lockDays: null })
  })

  it('lanca 404 quando o projeto nao existe', async () => {
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await expect(setLockDays('proj-1', 5)).rejects.toMatchObject({ status: 404 })
  })
})

describe('getLockStatusForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('retorna listas vazias quando o consultor nao tem projeto com prazo', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getLockStatusForUser('u1', '2026-01')
    expect(result).toEqual({ lockedProjects: [], upcomingDeadlines: [] })
  })

  it('classifica projeto vencido como bloqueado', async () => {
    vi.setSystemTime(new Date('2026-02-10T15:00:00Z')) // hoje = 10/02, bem depois do prazo
    vi.mocked(db.select).mockReturnValue(createChain([
      { projectId: 'p1', projectName: 'Projeto A', lockDays: 5 }, // deadline = 05/02
    ]) as never)

    const result = await getLockStatusForUser('u1', '2026-01')
    expect(result.lockedProjects).toEqual([{ projectId: 'p1', projectName: 'Projeto A', deadline: '2026-02-05' }])
    expect(result.upcomingDeadlines).toEqual([])
  })

  it('lista como prazo proximo quando faltam 3 dias ou menos', async () => {
    vi.setSystemTime(new Date('2026-02-02T15:00:00Z')) // hoje = 02/02, deadline 05/02 -> faltam 3 dias
    vi.mocked(db.select).mockReturnValue(createChain([
      { projectId: 'p1', projectName: 'Projeto A', lockDays: 5 },
    ]) as never)

    const result = await getLockStatusForUser('u1', '2026-01')
    expect(result.upcomingDeadlines).toEqual([
      { projectId: 'p1', projectName: 'Projeto A', deadline: '2026-02-05', daysLeft: 3 },
    ])
    expect(result.lockedProjects).toEqual([])
  })

  it('nao lista como prazo proximo quando faltam 4 dias', async () => {
    vi.setSystemTime(new Date('2026-02-01T15:00:00Z')) // hoje = 01/02, deadline 05/02 -> faltam 4 dias
    vi.mocked(db.select).mockReturnValue(createChain([
      { projectId: 'p1', projectName: 'Projeto A', lockDays: 5 },
    ]) as never)

    const result = await getLockStatusForUser('u1', '2026-01')
    expect(result.upcomingDeadlines).toEqual([])
    expect(result.lockedProjects).toEqual([])
  })

  it('ignora projetos finalizados', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await getLockStatusForUser('u1', '2026-01')

    expect(ne).toHaveBeenCalledWith(projects.status, 'finished')
  })
})
