import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  expensePayments: {
    id: 'id', userId: 'userId', periodStart: 'periodStart', periodEnd: 'periodEnd',
    status: 'status', totalAmount: 'totalAmount', receiptFileId: 'receiptFileId',
    confirmedAt: 'confirmedAt', confirmedBy: 'confirmedBy',
    paidAt: 'paidAt', paidBy: 'paidBy',
    cancelledAt: 'cancelledAt', cancelledBy: 'cancelledBy',
    notes: 'notes', createdAt: 'createdAt', createdBy: 'createdBy', updatedAt: 'updatedAt',
  },
  expensePaymentItems: {
    id: 'id', expensePaymentId: 'expensePaymentId', expenseId: 'expenseId', amount: 'amount',
  },
  expenses: {
    id: 'id', consultantUserId: 'consultantUserId', projectId: 'projectId',
    status: 'status', requiresReimbursement: 'requiresReimbursement',
    amount: 'amount', approvedAmount: 'approvedAmount', date: 'date',
    reimbursedAt: 'reimbursedAt', reimbursedBy: 'reimbursedBy',
    description: 'description', expenseCategoryId: 'expenseCategoryId', updatedAt: 'updatedAt',
  },
  projectExpensePeriods: {
    id: 'id', projectId: 'projectId', weekStart: 'weekStart', weekEnd: 'weekEnd',
  },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  users: { id: 'id', name: 'name' },
  projects: { id: 'id', name: 'name' },
  projectExpenseCategories: { id: 'id', name: 'name' },
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
  getAvailablePeriods, generateDraft, updatePayment, confirm, pay,
  cancel, revert, remove, list, listMy, getById,
  addExpenseToDraft, removeExpenseFromDraft, checkExpensePaymentLink, getReceipt,
} from '../expense-payment.service'
import { db } from '../../db'

beforeEach(() => vi.clearAllMocks())

// ─── getAvailablePeriods ────────────────────────────────────────────────────

describe('getAvailablePeriods', () => {
  it('retorna periodos com despesas elegiveis', async () => {
    const periods = [{ periodId: 'per1', projectId: 'p1', projectName: 'Proj1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]
    const stats = { expenseCount: 3, totalAmount: '500.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never // no existing draft
      if (selectCall === 2) return createChain([{ projectId: 'p1' }]) as never // allocations
      if (selectCall === 3) return createChain(periods) as never
      return createChain([stats]) as never // expense stats
    })

    const result = await getAvailablePeriods('u1')
    expect(result.periods).toHaveLength(1)
    expect(result.existingDraftId).toBeNull()
  })

  it('retorna existingDraftId quando draft existe', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'draft1' }]) as never
      if (selectCall === 2) return createChain([{ projectId: 'p1' }]) as never
      if (selectCall === 3) return createChain([]) as never // no periods
      return createChain([]) as never
    })

    const result = await getAvailablePeriods('u1')
    expect(result.existingDraftId).toBe('draft1')
  })

  it('retorna existingDraftId null quando sem draft', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never // no draft
      if (selectCall === 2) return createChain([{ projectId: 'p1' }]) as never
      if (selectCall === 3) return createChain([]) as never
      return createChain([]) as never
    })

    const result = await getAvailablePeriods('u1')
    expect(result.existingDraftId).toBeNull()
  })

  it('retorna vazio quando consultor sem alocacoes', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      return createChain([]) as never // no allocations
    })

    const result = await getAvailablePeriods('u1')
    expect(result.periods).toEqual([])
  })
})

// ─── generateDraft ──────────────────────────────────────────────────────────

describe('generateDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('gera draft com periodos selecionados', async () => {
    const selectedPeriods = [
      { id: 'per1', projectId: 'p1', weekStart: '2024-06-01', weekEnd: '2024-06-07' },
    ]
    const expenseRows = [
      { id: 'exp1', amount: '100.00', approvedAmount: '90.00' },
      { id: 'exp2', amount: '200.00', approvedAmount: null },
    ]
    const mockPayment = { id: 'pay1', status: 'draft', totalAmount: '290.00' }
    const mockItems = [{ id: 'item1' }, { id: 'item2' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never // no existing draft
      if (selectCall === 2) return createChain(selectedPeriods) as never
      return createChain(expenseRows) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain(mockItems) as never)

    const result = await generateDraft('u1', ['per1'], 'admin1')
    expect(result).toMatchObject({ id: 'pay1', status: 'draft' })
    expect(result.items).toEqual(mockItems)
  })

  it('calcula periodStart/periodEnd como min/max das despesas', async () => {
    const selectedPeriods = [
      { id: 'per1', projectId: 'p1', weekStart: '2024-06-01', weekEnd: '2024-06-07' },
      { id: 'per2', projectId: 'p1', weekStart: '2024-06-08', weekEnd: '2024-06-14' },
    ]
    const mockPayment = { id: 'pay1', status: 'draft', periodStart: '2024-06-01', periodEnd: '2024-06-14' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain(selectedPeriods) as never
      return createChain([{ id: 'exp1', amount: '100.00', approvedAmount: null }]) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await generateDraft('u1', ['per1', 'per2'], 'admin1')
    expect(result).toBeDefined()
  })

  it('rejeita se draft ja existe para consultor (PAYMENT_EXISTS)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'existing-draft' }]) as never
    )

    await expect(generateDraft('u1', ['per1'], 'admin1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('rejeita se sem despesas elegiveis nos periodos (NO_EXPENSES)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', projectId: 'p1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      return createChain([]) as never // no expenses
    })

    await expect(generateDraft('u1', ['per1'], 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('items usam approvedAmount com fallback para amount', async () => {
    const expenseRows = [
      { id: 'exp1', amount: '100.00', approvedAmount: '80.00' },
      { id: 'exp2', amount: '200.00', approvedAmount: null },
    ]
    // Total should be 80 + 200 = 280
    const mockPayment = { id: 'pay1', status: 'draft', totalAmount: '280.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([]) as never
      if (selectCall === 2) return createChain([{ id: 'per1', projectId: 'p1', weekStart: '2024-06-01', weekEnd: '2024-06-07' }]) as never
      return createChain(expenseRows) as never
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([mockPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await generateDraft('u1', ['per1'], 'admin1')
    expect(result).toBeDefined()
    expect(db.insert).toHaveBeenCalledTimes(2)
  })
})

// ─── updatePayment ──────────────────────────────────────────────────────────

describe('updatePayment', () => {
  it('atualiza notes do draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft', notes: null }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', notes: 'nova nota' }]) as never
    )

    const result = await updatePayment('pay1', 'nova nota')
    expect(result).toMatchObject({ notes: 'nova nota' })
  })

  it('rejeita se nao encontrado (404)', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(updatePayment('xxx'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('rejeita se nao draft (NOT_DRAFT)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )

    await expect(updatePayment('pay1', 'nota'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── confirm ────────────────────────────────────────────────────────────────

describe('confirm', () => {
  it('muda status para confirmed', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )

    const result = await confirm('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'confirmed' })
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'paid' }]) as never
    )

    await expect(confirm('pay1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── pay ────────────────────────────────────────────────────────────────────

describe('pay', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('muda status para paid e aceita receiptFileId', async () => {
    const payment = { id: 'pay1', status: 'confirmed' }
    const items = [{ expenseId: 'exp1' }, { expenseId: 'exp2' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([payment]) as never
      return createChain(items) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...payment, status: 'paid', receiptFileId: 'file1' }]) as never
    )

    const result = await pay('pay1', 'admin1', 'file1')
    expect(result).toMatchObject({ status: 'paid' })
    // 1 update for expenses reimbursement + 1 update for payment
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('marca todas expenses como reimbursed', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'pay1', status: 'confirmed' }]) as never
      return createChain([{ expenseId: 'exp1' }]) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'paid' }]) as never
    )

    await pay('pay1', 'admin1')
    // Expenses update + payment update
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('rejeita se nao confirmed', async () => {
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

  it('cancela de draft (nao toca expenses)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'cancelled' }]) as never
    )

    const result = await cancel('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
    // Only payment update, no expense revert
    expect(db.update).toHaveBeenCalledTimes(1)
  })

  it('cancela de confirmed (nao toca expenses)', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'cancelled' }]) as never
    )

    const result = await cancel('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
    expect(db.update).toHaveBeenCalledTimes(1)
  })

  it('cancela de paid — reverte reimbursement', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'pay1', status: 'paid' }]) as never
      return createChain([{ expenseId: 'exp1' }, { expenseId: 'exp2' }]) as never
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'cancelled' }]) as never
    )

    const result = await cancel('pay1', 'admin1')
    expect(result).toMatchObject({ status: 'cancelled' })
    // 1 expense revert + 1 payment update
    expect(db.update).toHaveBeenCalledTimes(2)
  })

  it('rejeita se ja cancelled', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'cancelled' }]) as never
    )

    await expect(cancel('pay1', 'admin1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── revert ─────────────────────────────────────────────────────────────────

describe('revert', () => {
  it('reverte confirmed -> draft', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'pay1', status: 'confirmed', userId: 'u1' }]) as never
      return createChain([]) as never // no existing draft
    })
    vi.mocked(db.update).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )

    const result = await revert('pay1')
    expect(result).toMatchObject({ status: 'draft' })
  })

  it('rejeita se usuario ja tem outro draft (USER_HAS_DRAFT)', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([{ id: 'pay1', status: 'confirmed', userId: 'u1' }]) as never
      return createChain([{ id: 'other-draft' }]) as never // existing draft
    })

    await expect(revert('pay1'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('rejeita se nao confirmed', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft', userId: 'u1' }]) as never
    )

    await expect(revert('pay1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── remove ─────────────────────────────────────────────────────────────────

describe('remove', () => {
  it('deleta draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'draft' }]) as never
    )
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    await remove('pay1')
    expect(db.delete).toHaveBeenCalled()
  })

  it('rejeita se nao draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', status: 'confirmed' }]) as never
    )

    await expect(remove('pay1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── addExpenseToDraft ──────────────────────────────────────────────────────

describe('addExpenseToDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  const approvedExpense = {
    id: 'exp1', status: 'approved', requiresReimbursement: true,
    amount: '100.00', approvedAmount: '90.00', date: '2024-06-15', reimbursedAt: null,
  }

  it('adiciona expense a draft existente e recalcula totais', async () => {
    const existingDraft = {
      id: 'pay1', status: 'draft', userId: 'u1',
      periodStart: '2024-06-01', periodEnd: '2024-06-10', totalAmount: '500.00',
    }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([]) as never // no existing link
      return createChain([existingDraft]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...existingDraft, totalAmount: '590.00', periodEnd: '2024-06-15' }]) as never
    )

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toBeDefined()
    expect(db.insert).toHaveBeenCalled()
    expect(db.update).toHaveBeenCalled()
  })

  it('cria novo draft quando nao existe', async () => {
    const newPayment = { id: 'pay-new', status: 'draft' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([]) as never // no existing link
      return createChain([]) as never // no existing draft
    })
    vi.mocked(db.insert)
      .mockReturnValueOnce(createChain([newPayment]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toMatchObject({ id: 'pay-new' })
  })

  it('ignora se expense nao e approved', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ ...approvedExpense, status: 'pending' }]) as never
    )

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toBeNull()
  })

  it('ignora se expense nao requer reembolso', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ ...approvedExpense, requiresReimbursement: false }]) as never
    )

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toBeNull()
  })

  it('ignora se expense ja esta linkada a um pagamento ativo', async () => {
    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      return createChain([{ id: 'existing-link' }]) as never // already linked
    })

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toBeNull()
  })

  it('trata race condition 23505 (re-query e adiciona ao draft concorrente)', async () => {
    const error23505 = Object.assign(new Error('unique_violation'), { code: '23505' })
    const raceDraft = {
      id: 'race-draft', status: 'draft', userId: 'u1',
      periodStart: '2024-06-01', periodEnd: '2024-06-10', totalAmount: '300.00',
    }
    const updatedDraft = { ...raceDraft, totalAmount: '390.00' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([approvedExpense]) as never
      if (selectCall === 2) return createChain([]) as never // no existing link
      if (selectCall === 3) return createChain([]) as never // no existing draft
      return createChain([raceDraft]) as never // race draft found after 23505
    })

    let insertCall = 0
    vi.mocked(db.insert).mockImplementation(() => {
      insertCall++
      if (insertCall === 1) throw error23505 // payment creation fails
      return createChain([]) as never // item insert succeeds
    })
    vi.mocked(db.update).mockReturnValue(createChain([updatedDraft]) as never)

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toMatchObject({ id: 'race-draft' })
  })

  it('atualiza periodStart/periodEnd quando nova expense expande o range', async () => {
    const existingDraft = {
      id: 'pay1', status: 'draft', userId: 'u1',
      periodStart: '2024-06-05', periodEnd: '2024-06-10', totalAmount: '200.00',
    }
    // Expense date is before draft start
    const earlyExpense = { ...approvedExpense, date: '2024-06-01' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([earlyExpense]) as never
      if (selectCall === 2) return createChain([]) as never
      return createChain([existingDraft]) as never
    })
    vi.mocked(db.insert).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(
      createChain([{ ...existingDraft, periodStart: '2024-06-01' }]) as never
    )

    const result = await addExpenseToDraft('exp1', 'u1', 'admin1')
    expect(result).toBeDefined()
    expect(db.update).toHaveBeenCalled()
  })
})

// ─── removeExpenseFromDraft ─────────────────────────────────────────────────

describe('removeExpenseFromDraft', () => {
  beforeEach(() => {
    vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any))
  })

  it('remove item e recalcula totais', async () => {
    const item = { itemId: 'item1', paymentId: 'pay1', paymentStatus: 'draft' }
    const remainingItems = [{ amount: '100.00', expenseDate: '2024-06-05' }]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([item]) as never
      if (selectCall === 2) return createChain([{ count: 1 }]) as never // remaining count
      return createChain(remainingItems) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromDraft('exp1')
    expect(result).toMatchObject({ removed: true, paymentDeleted: false })
  })

  it('deleta pagamento inteiro se ficar sem items', async () => {
    const item = { itemId: 'item1', paymentId: 'pay1', paymentStatus: 'draft' }

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([item]) as never
      return createChain([{ count: 0 }]) as never // no remaining
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromDraft('exp1')
    expect(result).toMatchObject({ removed: true, paymentDeleted: true })
    expect(db.delete).toHaveBeenCalledTimes(2) // item + payment
  })

  it('recalcula periodStart/periodEnd apos remocao', async () => {
    const item = { itemId: 'item1', paymentId: 'pay1', paymentStatus: 'draft' }
    const remainingItems = [
      { amount: '100.00', expenseDate: '2024-06-03' },
      { amount: '200.00', expenseDate: '2024-06-10' },
    ]

    let selectCall = 0
    vi.mocked(db.select).mockImplementation(() => {
      selectCall++
      if (selectCall === 1) return createChain([item]) as never
      if (selectCall === 2) return createChain([{ count: 2 }]) as never
      return createChain(remainingItems) as never
    })
    vi.mocked(db.delete).mockReturnValue(createChain([]) as never)
    vi.mocked(db.update).mockReturnValue(createChain([]) as never)

    const result = await removeExpenseFromDraft('exp1')
    expect(result).toMatchObject({ removed: true, paymentDeleted: false })
    expect(db.update).toHaveBeenCalled()
  })

  it('rejeita se pagamento nao e draft', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ itemId: 'item1', paymentId: 'pay1', paymentStatus: 'confirmed' }]) as never
    )

    await expect(removeExpenseFromDraft('exp1'))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ─── checkExpensePaymentLink ────────────────────────────────────────────────

describe('checkExpensePaymentLink', () => {
  it('retorna linked com paymentId e status quando existe', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ paymentId: 'pay1', paymentStatus: 'confirmed' }]) as never
    )

    const result = await checkExpensePaymentLink('exp1')
    expect(result).toMatchObject({ linked: true, paymentId: 'pay1', paymentStatus: 'confirmed' })
  })

  it('retorna unlinked quando nao existe', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    const result = await checkExpensePaymentLink('exp1')
    expect(result).toMatchObject({ linked: false })
  })
})

// ─── getById ────────────────────────────────────────────────────────────────

describe('getById', () => {
  it('super_admin ve tudo', async () => {
    const payment = { id: 'pay1', userId: 'u1' }
    const items = [{ id: 'item1' }]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([payment]) as never)
      .mockReturnValueOnce(createChain(items) as never)

    const result = await getById('pay1', 'admin1', 'super_admin')
    expect(result).toMatchObject({ id: 'pay1' })
    expect(result.items).toEqual(items)
  })

  it('administrative ve tudo', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1', userId: 'u1' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await getById('pay1', 'other', 'administrative')
    expect(result).toMatchObject({ id: 'pay1' })
  })

  it('consultor ve seus proprios', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1', userId: 'u1' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)

    const result = await getById('pay1', 'u1', 'consultor')
    expect(result).toMatchObject({ id: 'pay1' })
  })

  it('outro usuario -> 403', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ id: 'pay1', userId: 'u1' }]) as never
    )

    await expect(getById('pay1', 'other-user', 'consultor'))
      .rejects.toMatchObject({ status: 403 })
  })
})

// ─── list / listMy ──────────────────────────────────────────────────────────

describe('list', () => {
  it('lista paginada com filtros', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await list({ page: 1, limit: 20, userId: 'u1', status: 'draft' })
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

describe('listMy', () => {
  it('filtra por userId', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'pay1' }]) as never)
      .mockReturnValueOnce(createChain([{ total: 1 }]) as never)

    const result = await listMy('u1', { page: 1, limit: 20 })
    expect(result.data).toHaveLength(1)
    expect(result.meta).toMatchObject({ total: 1 })
  })
})

// ─── getReceipt ─────────────────────────────────────────────────────────────

describe('getReceipt', () => {
  it('retorna presigned URL', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: 'file1' }]) as never
    )
    mocks.getPresignedUrl.mockResolvedValue({ url: 'https://signed.url' })

    const result = await getReceipt('pay1', 'u1', 'consultor')
    expect(mocks.getPresignedUrl).toHaveBeenCalledWith('file1')
    expect(result).toMatchObject({ url: 'https://signed.url' })
  })

  it('404 sem comprovante', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: null }]) as never
    )

    await expect(getReceipt('pay1', 'u1', 'consultor'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('403 nao autorizado', async () => {
    vi.mocked(db.select).mockReturnValue(
      createChain([{ userId: 'u1', receiptFileId: 'file1' }]) as never
    )

    await expect(getReceipt('pay1', 'other', 'consultor'))
      .rejects.toMatchObject({ status: 403 })
  })
})
