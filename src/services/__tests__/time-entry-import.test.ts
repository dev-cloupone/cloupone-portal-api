import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'
import * as XLSX from 'xlsx'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ type: 'ilike', val })),
}))

vi.mock('../../db/schema', () => ({
  timeEntries: { id: 'id', userId: 'userId', projectId: 'projectId', date: 'date', startTime: 'startTime', endTime: 'endTime', hours: 'hours', description: 'description', ticketId: 'ticketId', subphaseId: 'subphaseId', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  projects: { id: 'id', name: 'name', clientId: 'clientId' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  users: { id: 'id', name: 'name' },
  tickets: { id: 'id', code: 'code', title: 'title', projectId: 'projectId' },
  consultantProfiles: { userId: 'userId', allowOverlappingEntries: 'allowOverlappingEntries' },
  monthlyTimesheets: { id: 'id', userId: 'userId', year: 'year', month: 'month', status: 'status' },
  projectSubphases: { id: 'id', phaseId: 'phaseId', name: 'name', status: 'status' },
  projectPhases: { id: 'id', projectId: 'projectId' },
  subphaseConsultants: { id: 'id', subphaseId: 'subphaseId', userId: 'userId' },
  importLogs: { id: 'id', userId: 'userId', consultantId: 'consultantId', filename: 'filename', totalRows: 'totalRows', imported: 'imported', skipped: 'skipped', createdAt: 'createdAt' },
  clients: {},
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

const { mockIsMonthOpen, mockGetOrCreate } = vi.hoisted(() => ({
  mockIsMonthOpen: vi.fn().mockResolvedValue(true),
  mockGetOrCreate: vi.fn().mockResolvedValue({ id: 'ts1', status: 'open' }),
}))

vi.mock('../monthly-timesheet.service', () => ({
  isMonthOpen: mockIsMonthOpen,
  getOrCreate: mockGetOrCreate,
}))

const mockTx = {
  select: vi.fn(),
  insert: vi.fn(),
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

import { parseFile, validateImport, confirmImport } from '../time-entry-import.service'
import { db } from '../../db'

// === HELPERS ===

function createXlsx(rows: Record<string, string>[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.from(out)
}

function createCsv(content: string): Buffer {
  return Buffer.from(content, 'utf-8')
}

const VALID_ROW = {
  Data: '02/06/2026',
  Projeto: 'Projeto A',
  Fase: 'Fase 1',
  Subfase: 'Subfase 1',
  Ticket: 'TK-001',
  'Início': '09:00',
  Fim: '18:00',
  'Descrição': 'Trabalho realizado',
}

// === TESTS ===

describe('parseFile', () => {
  it('parses xlsx with correct headers', () => {
    const buffer = createXlsx([VALID_ROW])
    const rows = parseFile(buffer, 'test.xlsx')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('02/06/2026')
    expect(rows[0].project).toBe('Projeto A')
    expect(rows[0].phase).toBe('Fase 1')
    expect(rows[0].subphase).toBe('Subfase 1')
    expect(rows[0].ticket).toBe('TK-001')
    expect(rows[0].startTime).toBe('09:00')
    expect(rows[0].endTime).toBe('18:00')
    expect(rows[0].description).toBe('Trabalho realizado')
  })

  it('parses csv with semicolon separator', () => {
    const csv = 'Data;Projeto;Fase;Subfase;Inicio;Fim\n02/06/2026;Projeto A;Fase 1;Subfase 1;09:00;18:00'
    const rows = parseFile(createCsv(csv), 'test.csv')
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe('02/06/2026')
    expect(rows[0].project).toBe('Projeto A')
  })

  it('parses csv with comma separator', () => {
    const csv = 'Data,Projeto,Fase,Subfase,Inicio,Fim\n02/06/2026,Projeto A,Fase 1,Subfase 1,09:00,18:00'
    const rows = parseFile(createCsv(csv), 'test.csv')
    expect(rows).toHaveLength(1)
    expect(rows[0].project).toBe('Projeto A')
  })

  it('rejects file without required headers', () => {
    const buffer = createXlsx([{ Projeto: 'A', Subfase: 'B' }])
    expect(() => parseFile(buffer, 'test.xlsx')).toThrow(AppError)
    expect(() => parseFile(buffer, 'test.xlsx')).toThrow(/Colunas obrigatórias/)
  })

  it('rejects file with >500 rows', () => {
    const rows = Array.from({ length: 501 }, () => ({ ...VALID_ROW }))
    const buffer = createXlsx(rows)
    expect(() => parseFile(buffer, 'test.xlsx')).toThrow('Máximo de 500 linhas por importação.')
  })

  it('ignores extra columns (Consultor, Horas)', () => {
    const buffer = createXlsx([{ ...VALID_ROW, Consultor: 'João', Horas: '8.00' }])
    const rows = parseFile(buffer, 'test.xlsx')
    expect(rows).toHaveLength(1)
    expect((rows[0] as Record<string, unknown>)['consultor']).toBeUndefined()
  })

  it('maps headers with accent (Início/Inicio, Descrição/Descricao)', () => {
    const buffer = createXlsx([{
      Data: '02/06/2026', Projeto: 'A', Fase: 'F', Subfase: 'B',
      Inicio: '09:00', Fim: '18:00', Descricao: 'test',
    }])
    const rows = parseFile(buffer, 'test.xlsx')
    expect(rows[0].startTime).toBe('09:00')
    expect(rows[0].description).toBe('test')
  })

  it('rejects invalid format', () => {
    expect(() => parseFile(Buffer.from('test'), 'test.txt')).toThrow('Formato inválido')
  })
})

describe('validateImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMonthOpen.mockResolvedValue(true)
  })

  function setupValidRow() {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      // 1: profile (allowOverlapping), 2: resolveProject, 3: resolveSubphase
      // 4: resolveTicket, 5: overlap check, 6: duplicate check
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      if (selectCall === 2) return createChain([{ id: 'p1' }]) as never // project
      if (selectCall === 3) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never // subphase
      if (selectCall === 4) return createChain([{ id: 'sc1' }]) as never // subphaseConsultant link
      if (selectCall === 5) return createChain([{ id: 't1' }]) as never // ticket
      if (selectCall === 6) return createChain([]) as never // no overlap
      if (selectCall === 7) return createChain([]) as never // no duplicate
      return createChain([]) as never
    })
  }

  it('validates a valid row returning status valid with resolvedIds', async () => {
    setupValidRow()
    const rows = [{
      date: '02/06/2026', project: 'Projeto A', phase: 'Fase 1', subphase: 'Subfase 1',
      ticket: 'TK-001', startTime: '09:00', endTime: '18:00', description: 'test',
    }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.valid).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.warnings).toBe(0)
    expect(result.rows[0].status).toBe('valid')
    expect(result.rows[0].resolvedIds).toEqual({ projectId: 'p1', subphaseId: 'sp1', ticketId: 't1' })
  })

  it('returns error for invalid date', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ allowOverlappingEntries: false }]) as never)
    const rows = [{ date: '99/99/9999', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].message).toContain('Data inválida')
  })

  it('returns error when month is closed', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ allowOverlappingEntries: false }]) as never)
    mockIsMonthOpen.mockResolvedValue(false)
    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Mês aprovado')
  })

  it('returns error for project not found', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      return createChain([]) as never // project not found
    })
    const rows = [{ date: '02/06/2026', project: 'Inexistente', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Projeto não encontrado')
  })

  it('returns error for subphase not in_progress', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      if (selectCall === 2) return createChain([{ id: 'p1' }]) as never // project
      return createChain([]) as never // subphase not found/not in_progress
    })
    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Subfase')
  })

  it('returns error for invalid time format', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ allowOverlappingEntries: false }]) as never)
    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '25:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Horário inválido')
  })

  it('returns error for duration <15min', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ allowOverlappingEntries: false }]) as never)
    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '09:10' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Duração mínima')
  })

  it('returns error for overlap with DB', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      if (selectCall === 2) return createChain([{ id: 'p1' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 4) return createChain([{ id: 'sc1' }]) as never // link
      // no ticket
      if (selectCall === 5) return createChain([{ id: 'overlap', startTime: '08:00', endTime: '10:00' }]) as never // overlap!
      return createChain([]) as never
    })
    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.errors).toBe(1)
    expect(result.rows[0].message).toContain('Sobreposição')
  })

  it('returns error for intra-file overlap', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never // profile

      // Row 1: valid
      if (selectCall === 2) return createChain([{ id: 'p1' }]) as never // project
      if (selectCall === 3) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 4) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 5) return createChain([]) as never // no overlap
      if (selectCall === 6) return createChain([]) as never // no duplicate

      // Row 2: same time same day
      if (selectCall === 7) return createChain([{ id: 'p1' }]) as never
      if (selectCall === 8) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 9) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 10) return createChain([]) as never // no DB overlap

      return createChain([]) as never
    })

    const rows = [
      { date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '12:00' },
      { date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '10:00', endTime: '14:00' },
    ]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.valid).toBe(1)
    expect(result.errors).toBe(1)
    expect(result.rows[1].status).toBe('error')
    expect(result.rows[1].message).toContain('Sobreposição com outra linha')
  })

  it('returns warning for duplicate entry', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      if (selectCall === 2) return createChain([{ id: 'p1' }]) as never
      if (selectCall === 3) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
      if (selectCall === 4) return createChain([{ id: 'sc1' }]) as never
      if (selectCall === 5) return createChain([]) as never // no overlap
      if (selectCall === 6) return createChain([{ id: 'existing-dup' }]) as never // duplicate found!
      return createChain([]) as never
    })

    const rows = [{ date: '02/06/2026', project: 'A', phase: 'F', subphase: 'B', startTime: '09:00', endTime: '18:00' }]
    const result = await validateImport(rows, 'u1', 'u1', 'consultor')
    expect(result.warnings).toBe(1)
    expect(result.rows[0].status).toBe('warning')
    expect(result.rows[0].message).toContain('duplicado')
    expect(result.rows[0].resolvedIds).toBeTruthy()
  })
})

describe('confirmImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMonthOpen.mockResolvedValue(true)
    mockGetOrCreate.mockResolvedValue({ id: 'ts1', status: 'open' })
  })

  it('inserts all entries in transaction', async () => {
    let mainSelectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      mainSelectCall++
      // 1: duplicate check (no dup found), 2: profile
      if (mainSelectCall === 1) return createChain([]) as never // no duplicate
      if (mainSelectCall === 2) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      return createChain([]) as never
    })

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(createChain([{ id: 'new' }]) as never),
      }
      let txSelectCall = 0
      tx.select.mockImplementation(() => {
        txSelectCall++
        if (txSelectCall === 1) return createChain([{ id: 'alloc1' }]) as never
        if (txSelectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
        if (txSelectCall === 3) return createChain([{ id: 'sc1' }]) as never
        if (txSelectCall === 4) return createChain([]) as never // no overlap
        return createChain([]) as never
      })
      return fn(tx as never)
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)

    const result = await confirmImport({
      consultantId: 'u1',
      rows: [{
        date: '2026-06-02', startTime: '09:00', endTime: '18:00',
        projectId: 'p1', subphaseId: 'sp1', ticketId: null, description: 'test',
      }],
      includeDuplicates: false,
    }, 'u1', 'consultor', 'test.xlsx')

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(db.insert).toHaveBeenCalled() // import log
  })

  it('rolls back if validation fails inside transaction', async () => {
    let mainSelectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      mainSelectCall++
      if (mainSelectCall === 1) return createChain([]) as never // no duplicate
      if (mainSelectCall === 2) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      return createChain([]) as never
    })

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnValue(createChain([]) as never), // allocation not found
        insert: vi.fn().mockReturnValue(createChain([]) as never),
      }
      return fn(tx as never)
    })

    await expect(confirmImport({
      consultantId: 'u1',
      rows: [{
        date: '2026-06-02', startTime: '09:00', endTime: '18:00',
        projectId: 'p1', subphaseId: 'sp1', ticketId: null, description: null,
      }],
      includeDuplicates: false,
    }, 'u1', 'consultor', 'test.xlsx')).rejects.toThrow('Consultor não está alocado')
  })

  it('respects includeDuplicates=false (skips duplicates)', async () => {
    // First select checks for duplicates - finds one
    let mainSelectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      mainSelectCall++
      if (mainSelectCall === 1) return createChain([{ id: 'dup' }]) as never // duplicate found
      if (mainSelectCall === 2) return createChain([{ allowOverlappingEntries: false }]) as never // profile
      return createChain([]) as never
    })

    vi.mocked(db.insert).mockReturnValue(createChain([]) as never) // import log

    // No transaction needed since all rows skipped
    const result = await confirmImport({
      consultantId: 'u1',
      rows: [{
        date: '2026-06-02', startTime: '09:00', endTime: '18:00',
        projectId: 'p1', subphaseId: 'sp1', ticketId: null, description: null,
      }],
      includeDuplicates: false,
    }, 'u1', 'consultor', 'test.xlsx')

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })

  it('respects includeDuplicates=true (includes duplicates)', async () => {
    let mainSelectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      mainSelectCall++
      if (mainSelectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      return createChain([]) as never
    })

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(createChain([{ id: 'new' }]) as never),
      }
      let txSelectCall = 0
      tx.select.mockImplementation(() => {
        txSelectCall++
        if (txSelectCall === 1) return createChain([{ id: 'alloc1' }]) as never
        if (txSelectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
        if (txSelectCall === 3) return createChain([{ id: 'sc1' }]) as never
        if (txSelectCall === 4) return createChain([]) as never // no overlap
        return createChain([]) as never
      })
      return fn(tx as never)
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)

    const result = await confirmImport({
      consultantId: 'u1',
      rows: [{
        date: '2026-06-02', startTime: '09:00', endTime: '18:00',
        projectId: 'p1', subphaseId: 'sp1', ticketId: null, description: null,
      }],
      includeDuplicates: true,
    }, 'u1', 'consultor', 'test.xlsx')

    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('creates import_log after successful transaction', async () => {
    let mainSelectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      mainSelectCall++
      if (mainSelectCall === 1) return createChain([{ allowOverlappingEntries: false }]) as never
      return createChain([]) as never
    })

    vi.mocked(db.transaction).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn(),
        insert: vi.fn().mockReturnValue(createChain([{ id: 'new' }]) as never),
      }
      let txSelectCall = 0
      tx.select.mockImplementation(() => {
        txSelectCall++
        if (txSelectCall === 1) return createChain([{ id: 'alloc1' }]) as never
        if (txSelectCall === 2) return createChain([{ id: 'sp1', status: 'in_progress' }]) as never
        if (txSelectCall === 3) return createChain([{ id: 'sc1' }]) as never
        if (txSelectCall === 4) return createChain([]) as never
        return createChain([]) as never
      })
      return fn(tx as never)
    })

    const insertChain = createChain([])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    await confirmImport({
      consultantId: 'u1',
      rows: [{
        date: '2026-06-02', startTime: '09:00', endTime: '18:00',
        projectId: 'p1', subphaseId: 'sp1', ticketId: null, description: null,
      }],
      includeDuplicates: false,
    }, 'actor1', 'consultor', 'test.xlsx')

    expect(db.insert).toHaveBeenCalled()
  })
})
