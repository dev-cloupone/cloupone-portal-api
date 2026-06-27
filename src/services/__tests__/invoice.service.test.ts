import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  ne: vi.fn(),
  asc: vi.fn(),
  sql: Object.assign(vi.fn(), { join: vi.fn() }),
  count: vi.fn(),
  desc: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  invoices: {
    id: 'id', invoiceNumber: 'invoiceNumber', clientId: 'clientId', projectId: 'projectId',
    year: 'year', month: 'month', status: 'status',
    totalHours: 'totalHours', totalAmount: 'totalAmount',
    clientName: 'clientName', clientCnpj: 'clientCnpj',
    issuedAt: 'issuedAt', issuedBy: 'issuedBy',
    paidAt: 'paidAt', paidBy: 'paidBy',
    cancelledAt: 'cancelledAt', cancelledBy: 'cancelledBy',
    notes: 'notes', createdAt: 'createdAt', createdBy: 'createdBy', updatedAt: 'updatedAt',
  },
  invoiceLines: {
    id: 'id', invoiceId: 'invoiceId', lineType: 'lineType',
    consultantId: 'consultantId', consultantName: 'consultantName',
    calculatedHours: 'calculatedHours', appliedHours: 'appliedHours',
    originalRate: 'originalRate', appliedRate: 'appliedRate',
    subtotal: 'subtotal', description: 'description',
  },
  projectAllocations: {
    id: 'id', projectId: 'projectId', userId: 'userId', billingRate: 'billingRate',
  },
  timeEntries: {
    id: 'id', userId: 'userId', projectId: 'projectId', date: 'date', hours: 'hours',
  },
  users: { id: 'id', name: 'name' },
  projects: { id: 'id', name: 'name', clientId: 'clientId' },
  clients: { id: 'id', companyName: 'companyName', cnpj: 'cnpj' },
  monthlyTimesheets: {
    id: 'id', userId: 'userId', year: 'year', month: 'month', status: 'status',
  },
  projectInstallments: {
    id: 'id', projectId: 'projectId', installmentNumber: 'installmentNumber',
    description: 'description', amount: 'amount', dueDate: 'dueDate',
    status: 'status', invoiceId: 'invoiceId',
  },
}))

const mocks = vi.hoisted(() => ({
  getNextInvoiceNumber: vi.fn(),
  loggerWarn: vi.fn(),
  buildMeta: vi.fn((_total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total: _total, totalPages: Math.ceil(_total / params.limit),
  })),
}))

vi.mock('../../utils/invoice-utils', () => ({
  getNextInvoiceNumber: mocks.getNextInvoiceNumber,
}))

vi.mock('../../utils/logger', () => ({
  logger: { warn: mocks.loggerWarn },
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: mocks.buildMeta,
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    selectDistinct: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'
import {
  generateDraft, regenerateInvoiceDraftsForConsultant,
  addCustomLine, removeCustomLine, updateLines,
  issue, pay, cancel, remove, revertToDraft, revertToIssued,
  getById, list, listByClient, getPendingApprovals,
  generateFromInstallments,
} from '../invoice.service'
import { getPendingInstallmentsDetailed } from '../installment.service'
import { db } from '../../db'

beforeEach(() => vi.clearAllMocks())

// ─── generateDraft ──────────────────────────────────────────────────────────

describe('generateDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('gera draft com snapshot do cliente', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: '12345678000100' }
    const entries = [{ userId: 'u1', totalHours: '40.00' }]
    const allocation = { billingRate: '200.00' }
    const user = { name: 'Joao' }
    const invoice = { id: 'inv1', status: 'draft', clientName: 'Acme Corp' }
    const line = { id: 'line1' }
    const updatedInvoice = { ...invoice, totalHours: '40.00', totalAmount: '8000.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never     // project+client
      if (selectCall === 2) return createChain([]) as never             // no existing draft
      if (selectCall === 3) return createChain(entries) as never        // time entries
      if (selectCall === 4) return createChain([allocation]) as never   // billing rate
      if (selectCall === 5) return createChain([user]) as never         // consultant name
      return createChain([]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([invoice]) as never)
      .mockReturnValueOnce(createChain([line]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updatedInvoice]) as never)

    const result = await generateDraft('p1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ id: 'inv1', status: 'draft' })
    expect(result.lines).toBeDefined()
  })

  it('cria lines por consultor agrupando time entries', async () => {
    const entries = [
      { userId: 'u1', totalHours: '20.00' },
      { userId: 'u2', totalHours: '30.00' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain(entries) as never
      if (selectCall % 2 === 0) return createChain([{ billingRate: '100.00' }]) as never
      return createChain([{ name: 'Dev' }]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1', status: 'draft' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    const result = await generateDraft('p1', 2024, 6, 'admin1')
    expect(result).toBeDefined()
    // 1 invoice insert + 2 line inserts
    expect(db.insert).toHaveBeenCalledTimes(3)
  })

  it('usa billingRate do projectAllocations', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain([{ userId: 'u1', totalHours: '10.00' }]) as never
      if (selectCall === 4) return createChain([{ billingRate: '300.00' }]) as never
      if (selectCall === 5) return createChain([{ name: 'Joao' }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1', status: 'draft' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1', totalAmount: '3000.00' }]) as never)

    const result = await generateDraft('p1', 2024, 6, 'admin1')
    expect(result).toBeDefined()
  })

  it('rejeita se draft ativa ja existe para projeto/mes (409)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      return createChain([{ id: 'existing-draft' }]) as never
    })

    await expect(generateDraft('p1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('rejeita se sem time entries', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([]) as never
      return createChain([]) as never // no entries
    })

    await expect(generateDraft('p1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('calcula totalHours e totalAmount corretamente', async () => {
    const entries = [{ userId: 'u1', totalHours: '25.00' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain(entries) as never
      if (selectCall === 4) return createChain([{ billingRate: '200.00' }]) as never
      if (selectCall === 5) return createChain([{ name: 'Ana' }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1', status: 'draft' }]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', totalHours: '25.00', totalAmount: '5000.00' }]) as never
    )

    const result = await generateDraft('p1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ totalHours: '25.00', totalAmount: '5000.00' })
  })
})

// ─── regenerateInvoiceDraftsForConsultant ────────────────────────────────────

describe('regenerateInvoiceDraftsForConsultant', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('encontra todos projetos com entries do consultor no mes', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(createChain([{ projectId: 'p1' }, { projectId: 'p2' }]) as never)

    // For each project, setup regen mocks (existing draft found, line updated)
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      // Each regenerateInvoiceDraftForProject needs: existing invoices, hours, allocation, user, existingLine, recalc lines
      return createChain([]) as never
    })

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.selectDistinct).toHaveBeenCalled()
  })

  it('continua processando se um projeto falha (try/catch individual)', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(
      createChain([{ projectId: 'p1' }, { projectId: 'p2' }]) as never
    )
    let txCall = 0
    vi.mocked(db.transaction).mockImplementation(async () => {
      txCall++
      if (txCall === 1) throw new Error('db error')
      return undefined
    })

    // Should not throw even though p1 fails
    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.transaction).toHaveBeenCalledTimes(2)
  })

  it('logger.warn chamado para projetos que falham', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(
      createChain([{ projectId: 'p1' }]) as never
    )
    vi.mocked(db.transaction).mockRejectedValue(new Error('fail'))

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(mocks.loggerWarn).toHaveBeenCalled()
  })

  it('chama regenerate para cada projeto', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(
      createChain([{ projectId: 'p1' }, { projectId: 'p2' }, { projectId: 'p3' }]) as never
    )
    vi.mocked(db.transaction).mockResolvedValue(undefined)

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.transaction).toHaveBeenCalledTimes(3)
  })
})

// ─── addOrUpdateConsultantLine (tested via regenerate) ──────────────────────

describe('addOrUpdateConsultantLine via regenerate', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('cria nova linha quando consultor nao tem linha na fatura', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(createChain([{ projectId: 'p1' }]) as never)

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ billingType: 'hourly' }]) as never // billingType check
      if (selectCall === 2) return createChain([{ id: 'inv1', status: 'draft', projectId: 'p1', year: 2024, month: 6 }]) as never // existing invoices
      if (selectCall === 3) return createChain([{ totalHours: '40.00' }]) as never // hours calc
      if (selectCall === 4) return createChain([{ billingRate: '200.00' }]) as never // allocation
      if (selectCall === 5) return createChain([{ name: 'Joao' }]) as never // user name
      if (selectCall === 6) return createChain([]) as never // no existing line
      if (selectCall === 7) return createChain([{ lineType: 'hours', appliedHours: '40.00', subtotal: '8000.00' }]) as never // recalc
      return createChain([]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.insert).toHaveBeenCalled()
  })

  it('preserva appliedHours/appliedRate se foram editados manualmente', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(createChain([{ projectId: 'p1' }]) as never)

    const existingLine = {
      id: 'line1', invoiceId: 'inv1', lineType: 'hours', consultantId: 'u1',
      calculatedHours: '40.00', appliedHours: '35.00', // manually edited
      originalRate: '200.00', appliedRate: '200.00',
    }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ billingType: 'hourly' }]) as never // billingType check
      if (selectCall === 2) return createChain([{ id: 'inv1', status: 'draft', projectId: 'p1', year: 2024, month: 6 }]) as never
      if (selectCall === 3) return createChain([{ totalHours: '45.00' }]) as never // new hours
      if (selectCall === 4) return createChain([{ billingRate: '200.00' }]) as never
      if (selectCall === 5) return createChain([{ name: 'Joao' }]) as never
      if (selectCall === 6) return createChain([existingLine]) as never // existing line with manual edit
      if (selectCall === 7) return createChain([{ lineType: 'hours', appliedHours: '35.00', subtotal: '7000.00' }]) as never
      return createChain([]) as never
    })
    const lineUpdateChain = createChain([])
    vi.mocked(db.update)
      .mockReturnValueOnce(lineUpdateChain as never)  // line update
      .mockReturnValueOnce(createChain([]) as never)   // invoice totals recalc

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.update).toHaveBeenCalled()
    // appliedHours preservado em 35 (edicao manual: applied != calculated anterior)
    expect(lineUpdateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      calculatedHours: '45.00',
      appliedHours: '35.00',
    }))
  })

  it('sobrescreve applied quando nao houve edicao manual', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(createChain([{ projectId: 'p1' }]) as never)

    const existingLine = {
      id: 'line1', invoiceId: 'inv1', lineType: 'hours', consultantId: 'u1',
      calculatedHours: '40.00', appliedHours: '40.00', // not edited (same as calculated)
      originalRate: '200.00', appliedRate: '200.00',
    }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ billingType: 'hourly' }]) as never // billingType check
      if (selectCall === 2) return createChain([{ id: 'inv1', status: 'draft', projectId: 'p1', year: 2024, month: 6 }]) as never
      if (selectCall === 3) return createChain([{ totalHours: '45.00' }]) as never
      if (selectCall === 4) return createChain([{ billingRate: '200.00' }]) as never
      if (selectCall === 5) return createChain([{ name: 'Joao' }]) as never
      if (selectCall === 6) return createChain([existingLine]) as never
      if (selectCall === 7) return createChain([{ lineType: 'hours', appliedHours: '45.00', subtotal: '9000.00' }]) as never
      return createChain([]) as never
    })
    const lineUpdateChain = createChain([])
    vi.mocked(db.update)
      .mockReturnValueOnce(lineUpdateChain as never)  // line update
      .mockReturnValueOnce(createChain([]) as never)   // invoice totals recalc

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.update).toHaveBeenCalled()
    // appliedHours atualizado para 45 (sem edicao manual: applied == calculated anterior)
    expect(lineUpdateChain.set).toHaveBeenCalledWith(expect.objectContaining({
      calculatedHours: '45.00',
      appliedHours: '45.00',
    }))
  })

  it('atualiza calculatedHours/originalRate quando ja existe', async () => {
    vi.mocked(db.selectDistinct).mockReturnValue(createChain([{ projectId: 'p1' }]) as never)

    const existingLine = {
      id: 'line1', invoiceId: 'inv1', lineType: 'hours', consultantId: 'u1',
      calculatedHours: '40.00', appliedHours: '40.00',
      originalRate: '200.00', appliedRate: '200.00',
    }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ billingType: 'hourly' }]) as never // billingType check
      if (selectCall === 2) return createChain([{ id: 'inv1', status: 'draft', projectId: 'p1', year: 2024, month: 6 }]) as never
      if (selectCall === 3) return createChain([{ totalHours: '50.00' }]) as never
      if (selectCall === 4) return createChain([{ billingRate: '250.00' }]) as never
      if (selectCall === 5) return createChain([{ name: 'Joao' }]) as never
      if (selectCall === 6) return createChain([existingLine]) as never
      if (selectCall === 7) return createChain([{ lineType: 'hours', appliedHours: '50.00', subtotal: '12500.00' }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await regenerateInvoiceDraftsForConsultant('u1', 2024, 6, 'admin1')
    expect(db.update).toHaveBeenCalled()
  })
})

// ─── addCustomLine ──────────────────────────────────────────────────────────

describe('addCustomLine', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('cria linha tipo custom com description/quantity/unitPrice', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    ).mockReturnValueOnce(
      createChain([{ lineType: 'custom', appliedHours: '2', subtotal: '1000.00' }]) as never
    )
    vi.mocked(db.insert).mockReturnValue(
      createChain([{ id: 'line-custom', lineType: 'custom' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    const result = await addCustomLine('inv1', { description: 'Taxa extra', quantity: '2', unitPrice: '500.00' })
    expect(result).toMatchObject({ lineType: 'custom' })
  })

  it('recalcula totais apos adicao', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    ).mockReturnValueOnce(
      createChain([
        { lineType: 'hours', appliedHours: '40.00', subtotal: '8000.00' },
        { lineType: 'custom', appliedHours: '1', subtotal: '500.00' },
      ]) as never
    )
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'line-new' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await addCustomLine('inv1', { description: 'Extra', quantity: '1', unitPrice: '500.00' })
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita se fatura nao e draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(addCustomLine('inv1', { description: 'X', quantity: '1', unitPrice: '100' }))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── removeCustomLine ───────────────────────────────────────────────────────

describe('removeCustomLine', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('remove linha custom e recalcula totais', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([{ id: 'line1', invoiceId: 'inv1', lineType: 'custom' }]) as never)
      .mockReturnValueOnce(createChain([{ lineType: 'hours', appliedHours: '40.00', subtotal: '8000.00' }]) as never)
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await removeCustomLine('inv1', 'line1')
    expect(db.delete).toHaveBeenCalled()
  })

  it('verifica que linha pertence a fatura', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([{ id: 'line1', invoiceId: 'inv-other' }]) as never)

    await expect(removeCustomLine('inv1', 'line1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejeita se fatura nao e draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'paid' }]) as never
    )

    await expect(removeCustomLine('inv1', 'line1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── updateLines ────────────────────────────────────────────────────────────

describe('updateLines', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('atualiza appliedHours e appliedRate em lines tipo hours', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([{ lineType: 'hours', appliedHours: '30.00', subtotal: '6000.00' }]) as never)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    const result = await updateLines('inv1', [
      { id: 'l1', appliedHours: '30.00', appliedRate: '200.00' },
    ])
    expect(result).toBeDefined()
  })

  it('atualiza description em custom lines', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([{ lineType: 'custom', appliedHours: '1', subtotal: '500.00' }]) as never)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await updateLines('inv1', [
      { id: 'l1', appliedHours: '1', appliedRate: '500.00', description: 'Updated desc' },
    ])
    expect(db.update).toHaveBeenCalled()
  })

  it('recalcula totalHours (apenas hours) e totalAmount (hours + custom)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([
        { lineType: 'hours', appliedHours: '40.00', subtotal: '8000.00' },
        { lineType: 'custom', appliedHours: '1', subtotal: '500.00' },
      ]) as never)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await updateLines('inv1', [{ id: 'l1', appliedHours: '40.00', appliedRate: '200.00' }])
    // recalculateInvoiceTotals updates totalHours=40 (hours only), totalAmount=8500 (both)
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(updateLines('inv1', [{ id: 'l1', appliedHours: '10', appliedRate: '100' }]))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── issue ──────────────────────────────────────────────────────────────────

describe('issue', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('muda status para issued', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    mocks.getNextInvoiceNumber.mockResolvedValue(42)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued', invoiceNumber: 42 }]) as never
    )

    const result = await issue('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'issued', invoiceNumber: 42 })
  })

  it('gera invoiceNumber via getNextInvoiceNumber', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    mocks.getNextInvoiceNumber.mockResolvedValue(100)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued', invoiceNumber: 100 }]) as never
    )

    await issue('inv1', 'admin1')
    expect(mocks.getNextInvoiceNumber).toHaveBeenCalledTimes(1)
  })

  it('rejeita se nao draft (NOT_DRAFT_ISSUE)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'paid' }]) as never
    )

    await expect(issue('inv1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── pay ────────────────────────────────────────────────────────────────────

describe('pay', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('muda status para paid', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'paid' }]) as never
    )

    const result = await pay('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'paid' })
  })

  it('rejeita se nao issued (NOT_ISSUED)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )

    await expect(pay('inv1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── cancel ─────────────────────────────────────────────────────────────────

describe('cancel', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('cancela de draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'cancelled' }]) as never
    )

    const result = await cancel('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
  })

  it('cancela de issued', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'cancelled' }]) as never
    )

    const result = await cancel('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
  })

  it('rejeita se ja cancelled', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'cancelled' }]) as never
    )

    await expect(cancel('inv1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── remove ─────────────────────────────────────────────────────────────────

describe('remove', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('deleta draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    await remove('inv1')
    expect(db.delete).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(remove('inv1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── revertToDraft ──────────────────────────────────────────────────────────

describe('revertToDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('reverte issued -> draft', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', year: 2024, month: 6 }]) as never
      return createChain([]) as never // no existing draft
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft', invoiceNumber: null }]) as never
    )

    const result = await revertToDraft('inv1')
    expect(result).toMatchObject({ status: 'draft', invoiceNumber: null })
  })

  it('remove invoiceNumber (seta null)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', year: 2024, month: 6 }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft', invoiceNumber: null }]) as never
    )

    const result = await revertToDraft('inv1')
    expect(result?.invoiceNumber).toBeNull()
  })

  it('rejeita se draft ja existe para projeto/mes (DRAFT_EXISTS_REVERT, 409)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', year: 2024, month: 6 }]) as never
      return createChain([{ id: 'inv-draft' }]) as never // existing draft
    })

    await expect(revertToDraft('inv1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('trata constraint violation 23505', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', year: 2024, month: 6 }]) as never
      return createChain([]) as never
    })

    const error23505 = Object.assign(new Error('unique'), { code: '23505' })
    vi.mocked(db.update).mockImplementation(() => { throw error23505 })

    await expect(revertToDraft('inv1'))
      .rejects.toMatchObject({ status: 409 })
  })
})

// ─── revertToIssued ─────────────────────────────────────────────────────────

describe('revertToIssued', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('reverte paid -> issued', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'paid' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    const result = await revertToIssued('inv1')
    expect(result).toMatchObject({ status: 'issued' })
  })

  it('rejeita se nao paid (NOT_PAID_REVERT)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(revertToIssued('inv1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── getById ────────────────────────────────────────────────────────────────

describe('getById', () => {
  it('super_admin ve tudo', async () => {
    const invoice = { id: 'inv1', clientId: 'c1', status: 'draft' }
    const lines = [{ id: 'l1' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([invoice]) as never)
      .mockReturnValueOnce(createChain(lines) as never)

    const result = await getById('inv1', 'admin1', 'super_admin')
    expect(result).toMatchObject({ id: 'inv1' })
    expect(result.lines).toEqual(lines)
  })

  it('administrative ve tudo', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', clientId: 'c1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await getById('inv1', 'user1', 'administrative')
    expect(result).toMatchObject({ id: 'inv1' })
  })

  it('client ve apenas issued/paid do seu clientId', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', clientId: 'c1', status: 'issued' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await getById('inv1', 'client-user', 'client', 'c1')
    expect(result).toMatchObject({ id: 'inv1' })
  })

  it('client nao ve draft do seu clientId', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', clientId: 'c1', status: 'draft' }]) as never
    )

    await expect(getById('inv1', 'client-user', 'client', 'c1'))
      .rejects.toMatchObject({ status: 403 })
  })

  it('outro role -> 403', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', clientId: 'c1', status: 'issued' }]) as never
    )

    await expect(getById('inv1', 'consultant', 'consultor'))
      .rejects.toMatchObject({ status: 403 })
  })
})

// ─── list / listByClient ───────────────────────────────────────────────────

describe('list', () => {
  it('lista paginada com filtros', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await list({ page: 1, limit: 20, projectId: 'p1', status: 'draft' })
    expect(result.data).toHaveLength(1)
    expect(result.meta).toMatchObject({ page: 1, total: 1 })
  })

  it('retorna vazio sem resultados', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([]) as never)
      .mockReturnValueOnce(createChain([{ total: 0 }]) as never)

    const result = await list({ page: 1, limit: 20 })
    expect(result.data).toHaveLength(0)
  })
})

describe('listByClient', () => {
  it('filtra apenas issued/paid', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'issued' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await listByClient('c1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(1)
  })

  it('retorna vazio sem resultados', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([]) as never)
      .mockReturnValueOnce(createChain([{ total: 0 }]) as never)

    const result = await listByClient('c1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(0)
  })
})

// ─── getPendingApprovals ────────────────────────────────────────────────────

describe('getPendingApprovals', () => {
  it('retorna consultores com timesheets open/reopened', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ consultantName: 'Joao' }, { consultantName: 'Maria' }]) as never
    )

    const result = await getPendingApprovals(2024, 6)
    expect(result.count).toBe(2)
    expect(result.consultants).toEqual(['Joao', 'Maria'])
  })

  it('filtra por year/month', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await getPendingApprovals(2024, 6)
    expect(db.select).toHaveBeenCalled()
  })

  it('retorna vazio quando todos aprovados', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getPendingApprovals(2024, 6)
    expect(result.count).toBe(0)
    expect(result.consultants).toEqual([])
  })
})

// ─── generateFromInstallments ────────────────────────────────────────────────

describe('generateFromInstallments', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('gera fatura a partir de parcelas pendentes', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: '12345678000100', billingType: 'fixed_price', fixedPriceTotal: '50000.00' }
    const installments = [
      { id: 'inst1', projectId: 'p1', installmentNumber: 1, description: 'Parcela 1', amount: '5000.00', status: 'pending' },
      { id: 'inst2', projectId: 'p1', installmentNumber: 2, description: 'Parcela 2', amount: '5000.00', status: 'pending' },
    ]
    const invoice = { id: 'inv1', status: 'draft', invoiceType: 'fixed_price' }
    const line = { id: 'line1' }
    const updatedInvoice = { ...invoice, totalHours: '0', totalAmount: '10000.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never       // project+client
      if (selectCall === 2) return createChain(installments) as never    // installments
      if (selectCall === 3) return createChain([{ total: 10 }]) as never // total installments count
      return createChain([]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([invoice]) as never)   // invoice
      .mockReturnValueOnce(createChain([line]) as never)      // line 1
      .mockReturnValueOnce(createChain([line]) as never)      // line 2
    vi.mocked(db.update).mockReturnValue(createChain([updatedInvoice]) as never)

    const result = await generateFromInstallments('p1', ['inst1', 'inst2'], 2024, 6, 'admin1')
    expect(result).toMatchObject({ id: 'inv1', status: 'draft', invoiceType: 'fixed_price' })
    expect(result.lines).toHaveLength(2)
    expect(db.insert).toHaveBeenCalledTimes(3)
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita projeto que nao e fixed_price', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: null, billingType: 'hourly' }

    vi.mocked(db.select).mockReturnValue(createChain([project]) as never)

    await expect(generateFromInstallments('p1', ['inst1'], 2024, 6, 'admin1'))
      .rejects.toThrow(AppError)
    await expect(generateFromInstallments('p1', ['inst1'], 2024, 6, 'admin1'))
      .rejects.toThrow('valor fixo')
  })

  it('rejeita quando parcelas nao pertencem ao projeto', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: null, billingType: 'fixed_price' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never
      return createChain([]) as never // no installments found
    })

    await expect(generateFromInstallments('p1', ['inst1', 'inst2'], 2024, 6, 'admin1'))
      .rejects.toThrow('não pertencem')
  })

  it('rejeita parcelas que nao estao pendentes', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: null, billingType: 'fixed_price' }
    const installments = [
      { id: 'inst1', projectId: 'p1', installmentNumber: 1, description: 'Parcela 1', amount: '5000.00', status: 'invoiced' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never
      if (selectCall === 2) return createChain(installments) as never
      return createChain([]) as never
    })

    await expect(generateFromInstallments('p1', ['inst1'], 2024, 6, 'admin1'))
      .rejects.toThrow('pendentes')
  })

  it('rejeita projeto nao encontrado', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(generateFromInstallments('p1', ['inst1'], 2024, 6, 'admin1'))
      .rejects.toThrow('não encontrado')
  })

  it('gera descricao automatica no formato completo', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme Corp', clientCnpj: '12345678000100', billingType: 'fixed_price', fixedPriceTotal: '50000.00' }
    const installments = [
      { id: 'inst1', projectId: 'p1', installmentNumber: 3, description: 'Parcela 3', amount: '5000.00', status: 'pending' },
    ]
    const invoice = { id: 'inv1', status: 'draft', invoiceType: 'fixed_price' }
    const line = { id: 'line1' }
    const updatedInvoice = { ...invoice, totalHours: '0', totalAmount: '5000.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never       // project+client
      if (selectCall === 2) return createChain(installments) as never    // installments
      if (selectCall === 3) return createChain([{ total: 10 }]) as never // total installments count
      return createChain([]) as never
    })

    const lineChain = createChain([line])
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([invoice]) as never)   // invoice insert
      .mockReturnValueOnce(lineChain as never)                // line insert
    vi.mocked(db.update).mockReturnValue(createChain([updatedInvoice]) as never)

    await generateFromInstallments('p1', ['inst1'], 2024, 6, 'admin1')

    // Verify the line insert captured the correct description format
    const valuesCall = lineChain.values.mock.calls[0][0]
    expect(valuesCall.description).toContain('Parcela 3/10')
    expect(valuesCall.description).toContain('Ref. junho/2024')
    expect(valuesCall.description).toContain('Contrato: R$')
    expect(valuesCall.description).toContain('50.000,00')
  })
})

// ─── getPendingInstallmentsDetailed ─────────────────────────────────────────

describe('getPendingInstallmentsDetailed', () => {
  it('retorna parcelas agrupadas por projeto', async () => {
    const rows = [
      { id: 'inst1', installmentNumber: 1, description: 'Parcela 1', amount: '5000.00', dueDate: '2024-06-15', projectId: 'p1', projectName: 'Projeto Alpha', clientName: 'Acme Corp', fixedPriceTotal: '50000.00' },
      { id: 'inst2', installmentNumber: 2, description: 'Parcela 2', amount: '5000.00', dueDate: '2024-06-30', projectId: 'p1', projectName: 'Projeto Alpha', clientName: 'Acme Corp', fixedPriceTotal: '50000.00' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain(rows) as never            // pending installments query
      if (selectCall === 2) return createChain([{ projectId: 'p1', total: 10 }]) as never // total count
      return createChain([]) as never
    })

    const result = await getPendingInstallmentsDetailed(2024, 6)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].projectId).toBe('p1')
    expect(result.projects[0].installments).toHaveLength(2)
    expect(result.projects[0].installments[0].id).toBe('inst1')
    expect(result.projects[0].installments[1].id).toBe('inst2')
  })

  it('retorna totalInstallments correto (todas, nao so pendentes)', async () => {
    const rows = [
      { id: 'inst5', installmentNumber: 5, description: 'Parcela 5', amount: '5000.00', dueDate: '2024-06-15', projectId: 'p1', projectName: 'Projeto Alpha', clientName: 'Acme Corp', fixedPriceTotal: '50000.00' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain(rows) as never
      if (selectCall === 2) return createChain([{ projectId: 'p1', total: 10 }]) as never
      return createChain([]) as never
    })

    const result = await getPendingInstallmentsDetailed(2024, 6)
    expect(result.projects[0].totalInstallments).toBe(10)
  })

  it('retorna vazio quando nao ha parcelas pendentes', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await getPendingInstallmentsDetailed(2024, 6)
    expect(result.projects).toEqual([])
  })
})
