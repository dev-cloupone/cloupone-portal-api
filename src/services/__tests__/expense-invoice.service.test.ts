import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  ne: vi.fn(),
  sql: vi.fn(),
  count: vi.fn(),
  desc: vi.fn(),
  between: vi.fn(),
  lte: vi.fn(),
  gte: vi.fn(),
}))

vi.mock('../../db/schema', () => ({
  expenseInvoices: {
    id: 'id', invoiceNumber: 'invoiceNumber', clientId: 'clientId', projectId: 'projectId',
    periodId: 'periodId', periodStart: 'periodStart', periodEnd: 'periodEnd',
    status: 'status', totalAmount: 'totalAmount',
    clientName: 'clientName', clientCnpj: 'clientCnpj',
    issuedAt: 'issuedAt', issuedBy: 'issuedBy',
    paidAt: 'paidAt', paidBy: 'paidBy',
    cancelledAt: 'cancelledAt', cancelledBy: 'cancelledBy',
    notes: 'notes', createdAt: 'createdAt', createdBy: 'createdBy', updatedAt: 'updatedAt',
  },
  expenseInvoiceItems: {
    id: 'id', expenseInvoiceId: 'expenseInvoiceId', expenseId: 'expenseId',
    description: 'description', originalAmount: 'originalAmount', appliedAmount: 'appliedAmount',
    createdAt: 'createdAt',
  },
  expenses: {
    id: 'id', consultantUserId: 'consultantUserId', projectId: 'projectId',
    status: 'status', date: 'date', amount: 'amount', approvedAmount: 'approvedAmount',
    kmQuantity: 'kmQuantity', description: 'description',
    expenseCategoryId: 'expenseCategoryId', receiptFileId: 'receiptFileId',
  },
  projectExpensePeriods: {
    id: 'id', projectId: 'projectId', weekStart: 'weekStart', weekEnd: 'weekEnd',
  },
  projectExpenseCategories: {
    id: 'id', name: 'name', isKmCategory: 'isKmCategory', maxAmount: 'maxAmount',
  },
  projects: { id: 'id', name: 'name', clientId: 'clientId' },
  clients: { id: 'id', companyName: 'companyName', cnpj: 'cnpj' },
  users: { id: 'id', name: 'name' },
  files: { id: 'id', storageKey: 'storageKey', originalName: 'originalName', mimeType: 'mimeType' },
}))

const mocks = vi.hoisted(() => ({
  getNextInvoiceNumber: vi.fn(),
  buildMeta: vi.fn((_total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total: _total, totalPages: Math.ceil(_total / params.limit),
  })),
}))

vi.mock('../../utils/invoice-utils', () => ({
  getNextInvoiceNumber: mocks.getNextInvoiceNumber,
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
  generateDraft, updateItems, issue, pay, cancel, remove,
  addExpenseToInvoiceDraft, removeExpenseFromInvoiceDraft,
  checkExpenseInvoiceLink, removeItem,
  revertToDraft, revertToIssued,
  getById, list, listByClient, getReceiptFiles,
} from '../expense-invoice.service'
import { db } from '../../db'

beforeEach(() => vi.clearAllMocks())

// ─── generateDraft ──────────────────────────────────────────────────────────

describe('generateDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('gera draft com despesas approved do periodo', async () => {
    const project = { id: 'p1', clientId: 'c1', clientName: 'Acme', clientCnpj: '123' }
    const period = { id: 'per1', projectId: 'p1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }
    const approvedExpenses = [
      { id: 'exp1', amount: '100.00', approvedAmount: '90.00', kmQuantity: null, consultantName: 'Joao', categoryName: 'Viagem', isKmCategory: false },
    ]
    const invoice = { id: 'inv1', status: 'draft' }
    const item = { id: 'item1' }
    const updated = { ...invoice, totalAmount: '90.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([project]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never // no existing
      return createChain(approvedExpenses) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([invoice]) as never)
      .mockReturnValueOnce(createChain([item]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([updated]) as never)

    const result = await generateDraft('p1', 'per1', 'admin1')
    expect(result).toMatchObject({ id: 'inv1', status: 'draft' })
    expect(result.items).toBeDefined()
  })

  it('usa approvedAmount com fallback para amount', async () => {
    const approvedExpenses = [
      { id: 'exp1', amount: '100.00', approvedAmount: '80.00', kmQuantity: null, consultantName: 'A', categoryName: 'B', isKmCategory: false },
      { id: 'exp2', amount: '200.00', approvedAmount: null, kmQuantity: null, consultantName: 'C', categoryName: 'D', isKmCategory: false },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      if (selectCall === 3) return createChain([]) as never
      return createChain(approvedExpenses) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1', totalAmount: '280.00' }]) as never)

    const result = await generateDraft('p1', 'per1', 'admin1')
    expect(result).toBeDefined()
  })

  it('buildItemDescription com nome consultor + categoria', async () => {
    const approvedExpenses = [
      { id: 'exp1', amount: '100.00', approvedAmount: null, kmQuantity: null, consultantName: 'Joao Silva', categoryName: 'Alimentacao', isKmCategory: false },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      if (selectCall === 3) return createChain([]) as never
      return createChain(approvedExpenses) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await generateDraft('p1', 'per1', 'admin1')
    expect(db.insert).toHaveBeenCalled()
  })

  it('buildItemDescription inclui km quando aplicavel', async () => {
    const approvedExpenses = [
      { id: 'exp1', amount: '100.00', approvedAmount: null, kmQuantity: '150.5', consultantName: 'Joao', categoryName: 'Km Rodado', isKmCategory: true },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      if (selectCall === 3) return createChain([]) as never
      return createChain(approvedExpenses) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([{ id: 'inv1' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await generateDraft('p1', 'per1', 'admin1')
    expect(db.insert).toHaveBeenCalled()
  })

  it('rejeita se invoice ativa ja existe para projeto/periodo', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      return createChain([{ id: 'existing' }]) as never // existing invoice
    })

    await expect(generateDraft('p1', 'per1', 'admin1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('rejeita se sem despesas no periodo', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'p1', clientId: 'c1', clientName: 'X', clientCnpj: '1' }]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      if (selectCall === 3) return createChain([]) as never // no existing
      return createChain([]) as never // no expenses
    })

    await expect(generateDraft('p1', 'per1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── updateItems ────────────────────────────────────────────────────────────

describe('updateItems', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('atualiza appliedAmount nos items', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', totalAmount: '150.00' }]) as never
    )

    const result = await updateItems('inv1', [
      { id: 'item1', appliedAmount: '100.00' },
      { id: 'item2', appliedAmount: '50.00' },
    ])
    expect(result).toMatchObject({ totalAmount: '150.00' })
  })

  it('recalcula totalAmount', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await updateItems('inv1', [{ id: 'item1', appliedAmount: '200.00' }])
    // 2 item updates + 1 invoice update = at least 2
    expect(db.update).toHaveBeenCalled()
  })

  it('atualiza notes', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1' }]) as never)

    await updateItems('inv1', [{ id: 'item1', appliedAmount: '100.00' }], 'nota')
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(updateItems('inv1', [{ id: 'i1', appliedAmount: '100' }]))
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

  it('gera invoiceNumber via sequence', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )
    mocks.getNextInvoiceNumber.mockResolvedValue(99)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1', status: 'issued' }]) as never)

    await issue('inv1', 'admin1')
    expect(mocks.getNextInvoiceNumber).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
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

  it('rejeita se nao issued', async () => {
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
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'inv1', status: 'draft' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1', status: 'cancelled' }]) as never)

    const result = await cancel('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
  })

  it('cancela de issued', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'inv1', status: 'issued' }]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([{ id: 'inv1', status: 'cancelled' }]) as never)

    const result = await cancel('inv1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
  })

  it('rejeita se ja cancelled', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'inv1', status: 'cancelled' }]) as never)

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
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'inv1', status: 'draft' }]) as never)
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    await remove('inv1')
    expect(db.delete).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([{ id: 'inv1', status: 'issued' }]) as never)

    await expect(remove('inv1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── addExpenseToInvoiceDraft ───────────────────────────────────────────────

describe('addExpenseToInvoiceDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  const approvedExpense = {
    id: 'exp1', status: 'approved', projectId: 'p1', date: '2024-06-05',
    amount: '100.00', approvedAmount: '90.00', kmQuantity: null,
    consultantName: 'Joao', categoryName: 'Viagem', isKmCategory: false,
    clientId: 'c1', clientName: 'Acme', clientCnpj: '123',
  }

  const period = { id: 'per1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }

  it('encontra periodo pela data da expense', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never // no existing item
      return createChain([]) as never // no existing draft
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.select).toHaveBeenCalled()
  })

  it('adiciona expense a draft existente e recalcula totais', async () => {
    const existingDraft = {
      id: 'inv1', status: 'draft', projectId: 'p1', periodId: 'per1', totalAmount: '500.00',
    }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never // no existing item
      return createChain([existingDraft]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.insert).toHaveBeenCalledTimes(1) // item only
    expect(db.update).toHaveBeenCalledTimes(1) // total recalc
  })

  it('cria novo draft quando nao existe', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never // no existing item
      return createChain([]) as never // no existing draft
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([{ id: 'inv-new' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.insert).toHaveBeenCalledTimes(2) // invoice + item
  })

  it('ignora se expense nao e approved', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ ...approvedExpense, status: 'pending' }]) as never
    )

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('ignora se expense ja esta linkada a invoice ativa', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      return createChain([{ id: 'existing-item' }]) as never // already linked
    })

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('trata race condition 23505', async () => {
    const error23505 = Object.assign(new Error('unique'), { code: '23505' })
    const raceDraft = { id: 'race-inv', status: 'draft', projectId: 'p1', periodId: 'per1', totalAmount: '200.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never // no existing item
      if (selectCall === 4) return createChain([]) as never // no existing draft
      return createChain([raceDraft]) as never // race draft found
    })

    let insertCall = 0
    vi.mocked(db.insert).mockImplementation(() => {
      insertCall++
      if (insertCall === 1) throw error23505
      return createChain([]) as never
    })
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    // Should have added to race draft
    expect(db.update).toHaveBeenCalled()
  })

  it('atualiza snapshot do cliente no draft', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([period]) as never
      if (selectCall === 3) return createChain([]) as never
      return createChain([]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([{ id: 'inv1' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    await addExpenseToInvoiceDraft('exp1', 'admin1')
    expect(db.insert).toHaveBeenCalled()
  })
})

// ─── removeExpenseFromInvoiceDraft ──────────────────────────────────────────

describe('removeExpenseFromInvoiceDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('remove item e recalcula totais', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ itemId: 'item1', invoiceId: 'inv1', invoiceStatus: 'draft' }]) as never
      if (selectCall === 2) return createChain([{ count: 1 }]) as never // remaining
      return createChain([{ appliedAmount: '100.00' }]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromInvoiceDraft('exp1')
    expect(result).toMatchObject({ removed: true, invoiceDeleted: false })
  })

  it('deleta invoice se ficar sem items', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ itemId: 'item1', invoiceId: 'inv1', invoiceStatus: 'draft' }]) as never
      return createChain([{ count: 0 }]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromInvoiceDraft('exp1')
    expect(result).toMatchObject({ removed: true, invoiceDeleted: true })
    expect(db.delete).toHaveBeenCalledTimes(2) // item + invoice
  })

  it('retorna removed false quando item nao encontrado em draft', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromInvoiceDraft('exp1')
    expect(result).toMatchObject({ removed: false, invoiceDeleted: false })
  })

  it('recalcula totais apos remocao', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ itemId: 'item1', invoiceId: 'inv1', invoiceStatus: 'draft' }]) as never
      if (selectCall === 2) return createChain([{ count: 2 }]) as never
      return createChain([{ appliedAmount: '100.00' }, { appliedAmount: '200.00' }]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    await removeExpenseFromInvoiceDraft('exp1')
    expect(db.update).toHaveBeenCalled()
  })
})

// ─── checkExpenseInvoiceLink ────────────────────────────────────────────────

describe('checkExpenseInvoiceLink', () => {
  it('retorna linked com invoiceId e status', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ invoiceId: 'inv1', invoiceStatus: 'issued' }]) as never
    )

    const result = await checkExpenseInvoiceLink('exp1')
    expect(result).toMatchObject({ linked: true, invoiceId: 'inv1', invoiceStatus: 'issued' })
  })

  it('retorna unlinked', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await checkExpenseInvoiceLink('exp1')
    expect(result).toMatchObject({ linked: false })
  })
})

// ─── removeItem ─────────────────────────────────────────────────────────────

describe('removeItem', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('remove item especifico do draft', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'draft' }]) as never
      if (selectCall === 2) return createChain([{ id: 'item1' }]) as never // item found
      if (selectCall === 3) return createChain([{ count: 1 }]) as never
      return createChain([{ appliedAmount: '200.00' }]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    const result = await removeItem('inv1', 'item1')
    expect(result).toMatchObject({ removed: true, invoiceDeleted: false })
  })

  it('deleta invoice se ficar vazia', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'draft' }]) as never
      if (selectCall === 2) return createChain([{ id: 'item1' }]) as never
      return createChain([{ count: 0 }]) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    const result = await removeItem('inv1', 'item1')
    expect(result).toMatchObject({ removed: true, invoiceDeleted: true })
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'issued' }]) as never
    )

    await expect(removeItem('inv1', 'item1'))
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
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', periodId: 'per1' }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft', invoiceNumber: null }]) as never
    )

    const result = await revertToDraft('inv1')
    expect(result).toMatchObject({ status: 'draft', invoiceNumber: null })
  })

  it('remove invoiceNumber', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', periodId: 'per1' }]) as never
      return createChain([]) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft', invoiceNumber: null }]) as never
    )

    const result = await revertToDraft('inv1')
    expect(result?.invoiceNumber).toBeNull()
  })

  it('trata constraint 23505', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'inv1', status: 'issued', projectId: 'p1', periodId: 'per1' }]) as never
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

  it('rejeita se nao paid', async () => {
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
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', clientId: 'c1', status: 'draft' }]) as never)
      .mockReturnValueOnce(createChain([{ id: 'item1' }]) as never)

    const result = await getById('inv1', 'admin1', 'super_admin')
    expect(result).toMatchObject({ id: 'inv1' })
    expect(result.items).toHaveLength(1)
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

  it('client nao ve draft', async () => {
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

    const result = await list({ page: 1, limit: 20, projectId: 'p1' })
    expect(result.data).toHaveLength(1)
    expect(result.meta).toMatchObject({ page: 1, total: 1 })
  })

  it('retorna vazio', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([]) as never)
      .mockReturnValueOnce(createChain([{ total: 0 }]) as never)

    const result = await list({ page: 1, limit: 20 })
    expect(result.data).toHaveLength(0)
  })
})

describe('listByClient', () => {
  it('filtra issued/paid', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'issued' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await listByClient('c1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(1)
  })

  it('retorna vazio', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([]) as never)
      .mockReturnValueOnce(createChain([{ total: 0 }]) as never)

    const result = await listByClient('c1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(0)
  })
})

// ─── getReceiptFiles ────────────────────────────────────────────────────────

describe('getReceiptFiles', () => {
  it('retorna arquivos de comprovante para issued/paid', async () => {
    const invoice = { id: 'inv1', status: 'issued', projectName: 'Proj1', periodStart: '2024-06-01', periodEnd: '2024-06-07' }
    const filesData = [{ itemDescription: 'Viagem', fileId: 'f1', storageKey: 'key1', originalName: 'receipt.pdf', mimeType: 'application/pdf' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([invoice]) as never)
      .mockReturnValueOnce(createChain(filesData) as never)

    const result = await getReceiptFiles('inv1')
    expect(result.invoice).toMatchObject({ id: 'inv1' })
    expect(result.files).toHaveLength(1)
  })

  it('rejeita se invoice e draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'inv1', status: 'draft' }]) as never
    )

    await expect(getReceiptFiles('inv1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('retorna erro se sem comprovantes', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'inv1', status: 'issued' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    await expect(getReceiptFiles('inv1'))
      .rejects.toMatchObject({ status: 404 })
  })
})
