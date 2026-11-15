import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
}))

vi.mock('../../db/schema', () => ({
  projects: {
    id: 'id', name: 'name', status: 'status', timesheetLockDays: 'timesheetLockDays',
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
  isProjectLockedForDate, getLockConfig, setLockDays,
} from '../timesheet-lock.service'
import { db } from '../../db'
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

  it('libera a data exatamente no limite da janela (hoje - lockDays)', async () => {
    vi.setSystemTime(new Date('2026-02-10T15:00:00Z')) // hoje = 10/02 em Brasilia
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never) // minima permitida = 05/02

    const result = await isProjectLockedForDate('proj-1', '2026-02-05')
    expect(result).toEqual({ locked: false, earliestAllowed: '2026-02-05' })
  })

  it('bloqueia a data imediatamente anterior ao limite da janela', async () => {
    vi.setSystemTime(new Date('2026-02-10T15:00:00Z')) // hoje = 10/02, minima permitida = 05/02
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-02-04')
    expect(result.locked).toBe(true)
    expect(result.earliestAllowed).toBe('2026-02-05')
    expect(result.reason).toContain('05/02/2026')
    expect(result.reason).not.toContain('2026-02-05')
    expect(result.reason).toContain('Contate o administrador')
  })

  it('libera qualquer data futura, independente de lockDays', async () => {
    vi.setSystemTime(new Date('2026-02-10T15:00:00Z'))
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-03-01')
    expect(result).toEqual({ locked: false, earliestAllowed: '2026-02-05' })
  })

  it('a janela retroativa ignora o mes da data do lancamento (nao e mais fim de mes)', async () => {
    vi.setSystemTime(new Date('2026-03-10T15:00:00Z')) // hoje = 10/03, minima permitida = 05/03
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never)

    const result = await isProjectLockedForDate('proj-1', '2026-01-15') // lancamento de janeiro, bem antes da janela
    expect(result.locked).toBe(true)
    expect(result.earliestAllowed).toBe('2026-03-05')
  })

  it('calcula a janela corretamente atravessando fevereiro de ano bissexto', async () => {
    vi.setSystemTime(new Date('2028-03-02T15:00:00Z')) // hoje = 02/03/2028
    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 5 }]) as never) // 2028 e bissexto: 02/03 - 5 = 26/02

    const result = await isProjectLockedForDate('proj-1', '2028-02-26')
    expect(result).toEqual({ locked: false, earliestAllowed: '2028-02-26' })
  })

  it('com lockDays zero, apenas hoje fica liberado', async () => {
    vi.setSystemTime(new Date('2026-01-31T15:00:00Z')) // hoje = 31/01

    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 0 }]) as never)
    const today = await isProjectLockedForDate('proj-1', '2026-01-31')
    expect(today).toEqual({ locked: false, earliestAllowed: '2026-01-31' })

    vi.mocked(db.select).mockReturnValue(createChain([{ lockDays: 0 }]) as never)
    const yesterday = await isProjectLockedForDate('proj-1', '2026-01-30')
    expect(yesterday.locked).toBe(true)
    expect(yesterday.earliestAllowed).toBe('2026-01-31')
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
