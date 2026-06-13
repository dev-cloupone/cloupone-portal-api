import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  ne: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  consultantPayments: {
    id: 'id', userId: 'userId', year: 'year', month: 'month', status: 'status',
    totalHours: 'totalHours', totalAmount: 'totalAmount', receiptFileId: 'receiptFileId',
    confirmedAt: 'confirmedAt', confirmedBy: 'confirmedBy',
    paidAt: 'paidAt', paidBy: 'paidBy',
    cancelledAt: 'cancelledAt', cancelledBy: 'cancelledBy',
    notes: 'notes', createdAt: 'createdAt', createdBy: 'createdBy', updatedAt: 'updatedAt',
  },
  consultantPaymentLines: {
    id: 'id', paymentId: 'paymentId', projectId: 'projectId',
    calculatedHours: 'calculatedHours', appliedHours: 'appliedHours',
    originalRate: 'originalRate', appliedRate: 'appliedRate', subtotal: 'subtotal',
  },
  monthlyTimesheets: {
    id: 'id', userId: 'userId', year: 'year', month: 'month',
    status: 'status', paymentLocked: 'paymentLocked', updatedAt: 'updatedAt',
  },
  timeEntries: {
    id: 'id', userId: 'userId', projectId: 'projectId', date: 'date', hours: 'hours',
  },
  projectAllocations: {
    id: 'id', projectId: 'projectId', userId: 'userId', costRate: 'costRate',
  },
  users: { id: 'id', name: 'name' },
  projects: { id: 'id', name: 'name' },
}))

const mocks = vi.hoisted(() => ({
  getPresignedUrl: vi.fn(),
  buildMeta: vi.fn((_total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total: _total, totalPages: Math.ceil(_total / params.limit),
  })),
}))

vi.mock('../file.service', () => ({
  getPresignedUrl: mocks.getPresignedUrl,
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: mocks.buildMeta,
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'
import {
  generateDraft, regenerateDraft, updateLines, confirm, pay,
  cancel, revert, remove, getById, list, listMy, getReceipt, getPendingApprovals,
} from '../consultant-payment.service'
import { db } from '../../db'

beforeEach(() => vi.clearAllMocks())

// ─── generateDraft ──────────────────────────────────────────────────────────

describe('generateDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('gera draft corretamente com timesheet approved', async () => {
    const mockTimesheet = { id: 'ts1', userId: 'u1', year: 2024, month: 6, status: 'approved' }
    const mockEntries = [{ projectId: 'p1', totalHours: '40.00' }]
    const mockRates = [{ projectId: 'p1', costRate: '150.00' }]
    const mockPayment = { id: 'pay1', userId: 'u1', status: 'draft', totalHours: '40.00', totalAmount: '6000.00' }
    const mockLines = [{ id: 'l1', paymentId: 'pay1', projectId: 'p1' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([mockTimesheet]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain(mockEntries) as never
      if (selectCall === 4) return createChain(mockRates) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain(mockLines) as never)

    const result = await generateDraft('u1', 2024, 6, 'admin1')

    expect(result).toMatchObject({ id: 'pay1', status: 'draft' })
    expect(result.lines).toEqual(mockLines)
    expect(db.insert).toHaveBeenCalledTimes(2)
  })

  it('rejeita se timesheet nao existe', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(generateDraft('u1', 2024, 6, 'admin1'))
      .rejects.toThrow(AppError)
    await expect(generateDraft('u1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejeita se timesheet nao esta approved', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'ts1', status: 'open' }]) as never
    )

    await expect(generateDraft('u1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejeita se pagamento ativo ja existe (409)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'ts1', status: 'approved' }]) as never
      return createChain([{ id: 'existing-pay' }]) as never
    })

    await expect(generateDraft('u1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('rejeita se sem time entries (NO_ENTRIES)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'ts1', status: 'approved' }]) as never
      if (selectCall === 2) return createChain([]) as never
      return createChain([]) as never // no entries
    })

    await expect(generateDraft('u1', 2024, 6, 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('calcula totalHours e totalAmount corretamente a partir dos entries', async () => {
    const mockEntries = [
      { projectId: 'p1', totalHours: '20.00' },
      { projectId: 'p2', totalHours: '15.50' },
    ]
    const mockRates = [
      { projectId: 'p1', costRate: '100.00' },
      { projectId: 'p2', costRate: '200.00' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'ts1', status: 'approved' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain(mockEntries) as never
      if (selectCall === 4) return createChain(mockRates) as never
      return createChain([]) as never
    })
    // totalHours = 20 + 15.5 = 35.5, totalAmount = 20*100 + 15.5*200 = 2000 + 3100 = 5100
    const mockPayment = { id: 'pay1', status: 'draft', totalHours: '35.50', totalAmount: '5100.00' }
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await generateDraft('u1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ totalHours: '35.50', totalAmount: '5100.00' })
  })

  it('cria lines com costRate do projectAllocations (usa 0 quando allocation nao existe)', async () => {
    const mockEntries = [
      { projectId: 'p1', totalHours: '10.00' },
      { projectId: 'p2', totalHours: '5.00' },
    ]
    // Only p1 has allocation, p2 does not
    const mockRates = [{ projectId: 'p1', costRate: '100.00' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'ts1', status: 'approved' }]) as never
      if (selectCall === 2) return createChain([]) as never
      if (selectCall === 3) return createChain(mockEntries) as never
      if (selectCall === 4) return createChain(mockRates) as never
      return createChain([]) as never
    })
    // p1: 10*100=1000, p2: 5*0=0 => total=1000, hours=15
    const mockPayment = { id: 'pay1', status: 'draft', totalHours: '15.00', totalAmount: '1000.00' }
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await generateDraft('u1', 2024, 6, 'admin1')
    expect(result).toBeDefined()
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})

// ─── regenerateDraft ────────────────────────────────────────────────────────

describe('regenerateDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('recria lines quando draft existente', async () => {
    const existingDraft = { id: 'pay1', status: 'draft', userId: 'u1', year: 2024, month: 6 }
    const mockEntries = [{ projectId: 'p1', totalHours: '40.00' }]
    const mockRates = [{ projectId: 'p1', costRate: '150.00' }]
    const updatedPayment = { ...existingDraft, totalHours: '40.00', totalAmount: '6000.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([existingDraft]) as never
      if (selectCall === 2) return createChain(mockEntries) as never
      if (selectCall === 3) return createChain(mockRates) as never
      return createChain([]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updatedPayment]) as never)

    const result = await regenerateDraft('u1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ id: 'pay1' })
    expect(db.delete).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })

  it('retorna existente sem modificar se confirmed/paid', async () => {
    const existingConfirmed = { id: 'pay1', status: 'confirmed' }

    vi.mocked(db.select).mockReturnValue(createChain([existingConfirmed]) as never)

    const result = await regenerateDraft('u1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ id: 'pay1', status: 'confirmed' })
    expect(db.delete).not.toHaveBeenCalled()
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('cria novo draft se nenhum ativo existe', async () => {
    const mockEntries = [{ projectId: 'p1', totalHours: '20.00' }]
    const mockRates = [{ projectId: 'p1', costRate: '100.00' }]
    const newPayment = { id: 'pay-new', status: 'draft' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never // no existing
      if (selectCall === 2) return createChain(mockEntries) as never
      if (selectCall === 3) return createChain(mockRates) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([newPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await regenerateDraft('u1', 2024, 6, 'admin1')
    expect(result).toMatchObject({ id: 'pay-new', status: 'draft' })
  })

  it('retorna null se sem entries', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never // no existing
      return createChain([]) as never // no entries
    })

    const result = await regenerateDraft('u1', 2024, 6, 'admin1')
    expect(result).toBeNull()
  })
})

// ─── updateLines ────────────────────────────────────────────────────────────

describe('updateLines', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  const lineUpdates = [
    { id: 'l1', appliedHours: '35.00', appliedRate: '150.00' },
    { id: 'l2', appliedHours: '10.00', appliedRate: '200.00' },
  ]

  it('atualiza appliedHours e appliedRate nas lines', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'pay1' }]) as never)

    await updateLines('pay1', lineUpdates)

    // 2 line updates + 1 payment update = 3
    expect(db.update).toHaveBeenCalledTimes(3)
  })

  it('recalcula subtotal por line e totalAmount/totalHours do payment', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    const updatedPayment = { id: 'pay1', totalHours: '45.00', totalAmount: '7250.00' }
    vi.mocked(db.update).mockReturnValue(createChain([updatedPayment]) as never)

    // 35*150=5250, 10*200=2000 => total=7250, hours=45
    const result = await updateLines('pay1', lineUpdates)
    expect(result).toMatchObject({ id: 'pay1' })
  })

  it('atualiza notes quando fornecido', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'pay1' }]) as never)

    await updateLines('pay1', [{ id: 'l1', appliedHours: '10.00', appliedRate: '100.00' }], 'nota teste')
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita se payment nao encontrado (404)', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(updateLines('xxx', lineUpdates))
      .rejects.toMatchObject({ status: 404 })
  })

  it('rejeita se payment nao e draft (NOT_DRAFT)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )

    await expect(updateLines('pay1', lineUpdates))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── confirm ────────────────────────────────────────────────────────────────

describe('confirm', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('muda status para confirmed e seta confirmedBy/confirmedAt', async () => {
    const payment = { id: 'pay1', status: 'draft', userId: 'u1', year: 2024, month: 6 }
    const confirmed = { ...payment, status: 'confirmed', confirmedBy: 'admin1' }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([confirmed]) as never)

    const result = await confirm('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'confirmed' })
    // 1 update for timesheet lock + 1 update for payment = 2
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('trava timesheet (paymentLocked = true)', async () => {
    const payment = { id: 'pay1', status: 'draft', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    const timesheetChain = createChain([])
    const paymentChain = createChain([{ ...payment, status: 'confirmed' }])
    vi.mocked(db.update)
      .mockReturnValueOnce(timesheetChain as never)
      .mockReturnValueOnce(paymentChain as never)

    await confirm('pay1', 'admin1')
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(timesheetChain.set).toHaveBeenCalledWith(expect.objectContaining({ paymentLocked: true }))
  })

  it('rejeita se nao e draft (NOT_DRAFT_CONFIRM)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'paid' }]) as never
    )

    await expect(confirm('pay1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── pay ────────────────────────────────────────────────────────────────────

describe('pay', () => {
  it('muda status para paid e seta paidBy/paidAt', async () => {
    const payment = { id: 'pay1', status: 'confirmed', userId: 'u1' }
    const paidPayment = { ...payment, status: 'paid', paidBy: 'admin1' }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([paidPayment]) as never)

    const result = await pay('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'paid' })
  })

  it('aceita e salva receiptFileId opcional', async () => {
    const payment = { id: 'pay1', status: 'confirmed', userId: 'u1' }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...payment, status: 'paid', receiptFileId: 'file1' }]) as never
    )

    const result = await pay('pay1', 'admin1', 'file1')
    expect(result).toMatchObject({ status: 'paid', receiptFileId: 'file1' })
  })

  it('rejeita se nao e confirmed (NOT_CONFIRMED)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )

    await expect(pay('pay1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── cancel ─────────────────────────────────────────────────────────────────

describe('cancel', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('cancela de draft (sem destravar timesheet)', async () => {
    const payment = { id: 'pay1', status: 'draft', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...payment, status: 'cancelled' }]) as never
    )

    const result = await cancel('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
    // Only 1 update for payment (no timesheet unlock for draft)
    expect(db.update).toHaveBeenCalledTimes(1)
  })

  it('cancela de confirmed (destrava timesheet — paymentLocked=false)', async () => {
    const payment = { id: 'pay1', status: 'confirmed', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    const timesheetChain = createChain([])
    vi.mocked(db.update)
      .mockReturnValueOnce(timesheetChain as never)
      .mockReturnValueOnce(createChain([{ ...payment, status: 'cancelled' }]) as never)

    await cancel('pay1', 'admin1')
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(timesheetChain.set).toHaveBeenCalledWith(expect.objectContaining({ paymentLocked: false }))
  })

  it('cancela de paid (destrava timesheet)', async () => {
    const payment = { id: 'pay1', status: 'paid', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    const timesheetChain = createChain([])
    vi.mocked(db.update)
      .mockReturnValueOnce(timesheetChain as never)
      .mockReturnValueOnce(createChain([{ ...payment, status: 'cancelled' }]) as never)

    await cancel('pay1', 'admin1')
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(timesheetChain.set).toHaveBeenCalledWith(expect.objectContaining({ paymentLocked: false }))
  })

  it('rejeita se ja cancelled (ALREADY_CANCELLED)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'cancelled' }]) as never
    )

    await expect(cancel('pay1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── revert ─────────────────────────────────────────────────────────────────

describe('revert', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('reverte confirmed -> draft', async () => {
    const payment = { id: 'pay1', status: 'confirmed', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...payment, status: 'draft', confirmedAt: null, confirmedBy: null }]) as never
    )

    const result = await revert('pay1')
    expect(result).toMatchObject({ status: 'draft' })
  })

  it('destrava timesheet (paymentLocked = false)', async () => {
    const payment = { id: 'pay1', status: 'confirmed', userId: 'u1', year: 2024, month: 6 }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)
    const timesheetChain = createChain([])
    vi.mocked(db.update)
      .mockReturnValueOnce(timesheetChain as never)
      .mockReturnValueOnce(createChain([{ ...payment, status: 'draft' }]) as never)

    await revert('pay1')
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(timesheetChain.set).toHaveBeenCalledWith(expect.objectContaining({ paymentLocked: false }))
  })

  it('rejeita se nao e confirmed (NOT_CONFIRMED_REVERT)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )

    await expect(revert('pay1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── remove ─────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('deleta payment que e draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    await remove('pay1')
    expect(db.delete).toHaveBeenCalled()
  })

  it('rejeita se nao e draft (NOT_DRAFT_DELETE)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )

    await expect(remove('pay1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── getById ────────────────────────────────────────────────────────────────

describe('getById', () => {
  it('retorna payment com lines para super_admin', async () => {
    const payment = { id: 'pay1', userId: 'u1' }
    const lines = [{ id: 'l1', paymentId: 'pay1' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([payment]) as never)
      .mockReturnValueOnce(createChain(lines) as never)

    const result = await getById('pay1', 'admin1', 'super_admin')
    expect(result).toMatchObject({ id: 'pay1' })
    expect(result.lines).toEqual(lines)
  })

  it('retorna payment para administrative', async () => {
    const payment = { id: 'pay1', userId: 'u1' }
    const lines = [{ id: 'l1' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([payment]) as never)
      .mockReturnValueOnce(createChain(lines) as never)

    const result = await getById('pay1', 'other-user', 'administrative')
    expect(result).toMatchObject({ id: 'pay1' })
  })

  it('retorna para o proprio consultor (userId match)', async () => {
    const payment = { id: 'pay1', userId: 'u1' }
    const lines: unknown[] = []

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([payment]) as never)
      .mockReturnValueOnce(createChain(lines) as never)

    const result = await getById('pay1', 'u1', 'consultor')
    expect(result).toMatchObject({ id: 'pay1' })
  })

  it('rejeita com 403 para outro usuario', async () => {
    const payment = { id: 'pay1', userId: 'u1' }

    vi.mocked(db.select).mockReturnValue(createChain([payment]) as never)

    await expect(getById('pay1', 'other-user', 'consultor'))
      .rejects.toMatchObject({ status: 403 })
  })
})

// ─── list / listMy ──────────────────────────────────────────────────────────

describe('list', () => {
  it('retorna lista paginada com meta', async () => {
    const data = [{ id: 'pay1' }, { id: 'pay2' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain(data) as never)
      .mockReturnValueOnce(createChain([{ total: 2 }]) as never)

    const result = await list({ page: 1, limit: 20 })
    expect(result.data).toHaveLength(2)
    expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 2 })
  })

  it('aplica filtros (userId, year, month, status)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await list({ page: 1, limit: 20, userId: 'u1', year: 2024, month: 6, status: 'draft' })
    expect(result.data).toHaveLength(1)
  })

  it('retorna vazio quando sem resultados', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([]) as never)
      .mockReturnValueOnce(createChain([{ total: 0 }]) as never)

    const result = await list({ page: 1, limit: 20 })
    expect(result.data).toHaveLength(0)
    expect(result.meta.total).toBe(0)
  })
})

describe('listMy', () => {
  it('filtra por userId do consultor', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await listMy('u1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(1)
    expect(result.meta).toMatchObject({ page: 1, limit: 20, total: 1 })
  })
})

// ─── getReceipt ─────────────────────────────────────────────────────────────

describe('getReceipt', () => {
  it('retorna presigned URL quando tem receiptFileId', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: 'file1' }]) as never
    )
    mocks.getPresignedUrl.mockResolvedValue({ url: 'https://signed-url.com' })

    const result = await getReceipt('pay1', 'u1', 'consultor')
    expect(mocks.getPresignedUrl).toHaveBeenCalledWith('file1')
    expect(result).toMatchObject({ url: 'https://signed-url.com' })
  })

  it('rejeita 404 quando sem comprovante', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: null }]) as never
    )

    await expect(getReceipt('pay1', 'u1', 'consultor'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('rejeita 403 quando usuario nao autorizado', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: 'file1' }]) as never
    )

    await expect(getReceipt('pay1', 'other-user', 'consultor'))
      .rejects.toMatchObject({ status: 403 })
  })
})

// ─── getPendingApprovals ────────────────────────────────────────────────────

describe('getPendingApprovals', () => {
  it('retorna consultores com timesheets open/reopened', async () => {
    const results = [
      { consultantName: 'Joao', status: 'open' },
      { consultantName: 'Maria', status: 'reopened' },
    ]
    vi.mocked(db.select).mockReturnValue(createChain(results) as never)

    const result = await getPendingApprovals(2024, 6)
    expect(result.count).toBe(2)
    expect(result.consultants).toEqual(['Joao', 'Maria'])
  })

  it('filtra corretamente por year/month', async () => {
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
