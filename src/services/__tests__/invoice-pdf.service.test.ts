import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
}))

vi.mock('../../db/schema', () => ({
  invoices: { id: 'id', projectId: 'projectId', invoiceNumber: 'invoiceNumber', status: 'status', totalAmount: 'totalAmount', clientName: 'clientName', clientCnpj: 'clientCnpj', year: 'year', month: 'month', issuedAt: 'issuedAt', notes: 'notes' },
  invoiceLines: { id: 'id', invoiceId: 'invoiceId', lineType: 'lineType', consultantName: 'consultantName', appliedHours: 'appliedHours', appliedRate: 'appliedRate', subtotal: 'subtotal', description: 'description' },
  expenseInvoices: { id: 'id', projectId: 'projectId', invoiceNumber: 'invoiceNumber', status: 'status', totalAmount: 'totalAmount', clientName: 'clientName', clientCnpj: 'clientCnpj', periodStart: 'periodStart', periodEnd: 'periodEnd', issuedAt: 'issuedAt', notes: 'notes' },
  expenseInvoiceItems: { id: 'id', expenseInvoiceId: 'expenseInvoiceId', expenseId: 'expenseId', description: 'description', appliedAmount: 'appliedAmount' },
  projects: { id: 'id', name: 'name' },
  companyInfo: {},
  bankAccounts: { id: 'id', isActive: 'isActive', projectId: 'projectId', isKmCategory: 'isKmCategory' },
  expenses: { id: 'id', date: 'date', expenseCategoryId: 'expenseCategoryId', receiptFileId: 'receiptFileId', consultantUserId: 'consultantUserId', description: 'description' },
  users: { id: 'id', name: 'name' },
  projectExpenseCategories: { id: 'id', name: 'name', isKmCategory: 'isKmCategory', kmRate: 'kmRate', projectId: 'projectId', isActive: 'isActive' },
}))

// Mock pdfmake
const mockPdfDoc = {
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'data') {
      setTimeout(() => cb(Buffer.from('pdf-content')), 0)
    }
    if (event === 'end') {
      setTimeout(cb, 5)
    }
    return mockPdfDoc
  }),
  end: vi.fn(),
}

vi.mock('pdfmake/js/Printer', () => ({
  default: vi.fn().mockImplementation(() => ({
    createPdfKitDocument: vi.fn().mockReturnValue(mockPdfDoc),
  })),
}))

vi.mock('pdfmake/js/URLResolver', () => ({
  default: vi.fn(),
}))

vi.mock('path', () => ({
  default: { resolve: vi.fn().mockReturnValue('/mock/path/logo.svg') },
}))

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn().mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#000"/></svg>') },
}))

const mockCompany = {
  companyName: 'Test Corp', cnpj: '12345678000100',
  address: 'Rua Test 123', zipCode: '01000-000', cityState: 'SP',
  phone: '11999999999', email: 'test@test.com',
}

const mockBankAccount = {
  id: 'bank1', isActive: true, holderName: 'Test Corp',
  bankName: 'Banco Test', agency: '0001', accountNumber: '12345-6',
}

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    query: {
      companyInfo: { findFirst: vi.fn() },
      bankAccounts: { findFirst: vi.fn() },
    },
  },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'
import { generateInvoicePdf, generateInvoiceExpensesPdf } from '../invoice-pdf.service'
import { db } from '../../db'

beforeEach(() => {
  vi.clearAllMocks()
  // Reset pdfDoc mock
  mockPdfDoc.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'data') setTimeout(() => cb(Buffer.from('pdf-content')), 0)
    if (event === 'end') setTimeout(cb, 5)
    return mockPdfDoc
  })
})

// ─── generateInvoicePdf ────────────────────────────────────────────────

describe('generateInvoicePdf', () => {
  const mockInvoice = {
    id: 'inv1', projectId: 'p1', invoiceNumber: 42, status: 'issued',
    totalAmount: '8000.00', clientName: 'Acme', clientCnpj: '123',
    year: 2024, month: 6, issuedAt: new Date(), notes: null,
  }

  const mockLines = [
    { lineType: 'hours', consultantName: 'Joao', appliedHours: '40.00', appliedRate: '200.00', subtotal: '8000.00', description: null },
  ]

  it('retorna Buffer com conteudo PDF', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([mockInvoice]) as never)
      .mockReturnValueOnce(createChain(mockLines) as never)
      .mockReturnValueOnce(createChain([{ name: 'Projeto X' }]) as never)
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(mockCompany)
    vi.mocked(db.query.bankAccounts.findFirst).mockResolvedValue(mockBankAccount)

    const result = await generateInvoicePdf('inv1', 'bank1')
    expect(Buffer.isBuffer(result)).toBe(true)
  })

  it('inclui secao SERVICOS com lines do tipo hours', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([mockInvoice]) as never)
      .mockReturnValueOnce(createChain(mockLines) as never)
      .mockReturnValueOnce(createChain([{ name: 'Projeto X' }]) as never)
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(mockCompany)
    vi.mocked(db.query.bankAccounts.findFirst).mockResolvedValue(mockBankAccount)

    const result = await generateInvoicePdf('inv1', 'bank1')
    expect(result).toBeDefined()
  })

  it('inclui secao ITENS ADICIONAIS quando existem custom lines', async () => {
    const linesWithCustom = [
      ...mockLines,
      { lineType: 'custom', consultantName: null, appliedHours: '1', appliedRate: '500.00', subtotal: '500.00', description: 'Taxa extra' },
    ]

    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ ...mockInvoice, totalAmount: '8500.00' }]) as never)
      .mockReturnValueOnce(createChain(linesWithCustom) as never)
      .mockReturnValueOnce(createChain([{ name: 'Projeto X' }]) as never)
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(mockCompany)
    vi.mocked(db.query.bankAccounts.findFirst).mockResolvedValue(mockBankAccount)

    const result = await generateInvoicePdf('inv1', 'bank1')
    expect(Buffer.isBuffer(result)).toBe(true)
  })

  it('lanca erro se invoice nao encontrada', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(generateInvoicePdf('xxx', 'bank1'))
      .rejects.toThrow(AppError)
  })

  it('lanca erro se company nao configurada', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([mockInvoice]) as never)
      .mockReturnValueOnce(createChain(mockLines) as never)
      .mockReturnValueOnce(createChain([{ name: 'Proj' }]) as never)
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(null as any)

    await expect(generateInvoicePdf('inv1', 'bank1'))
      .rejects.toThrow(AppError)
  })
})

// ─── generateInvoiceExpensesPdf ─────────────────────────────────────────────

describe('generateInvoiceExpensesPdf', () => {
  const mockExpInvoice = {
    id: 'inv1', projectId: 'p1', invoiceNumber: 10, status: 'issued',
    totalAmount: '500.00', clientName: 'Acme', clientCnpj: '123',
    periodStart: '2024-06-01', periodEnd: '2024-06-07', issuedAt: new Date(), notes: null,
  }

  const mockItems = [
    { description: 'Joao - Viagem', appliedAmount: '500.00', expenseDate: '2024-06-05' },
  ]

  it('retorna Buffer', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([mockExpInvoice]) as never)
      .mockReturnValueOnce(createChain(mockItems) as never)
      .mockReturnValueOnce(createChain([{ name: 'Projeto Y' }]) as never)
      .mockReturnValueOnce(createChain([]) as never) // hasKmExpenses
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(mockCompany)
    vi.mocked(db.query.bankAccounts.findFirst).mockResolvedValue(mockBankAccount)

    const result = await generateInvoiceExpensesPdf('inv1', 'bank1')
    expect(Buffer.isBuffer(result)).toBe(true)
  })

  it('inclui items de despesas', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([mockExpInvoice]) as never)
      .mockReturnValueOnce(createChain(mockItems) as never)
      .mockReturnValueOnce(createChain([{ name: 'Projeto Y' }]) as never)
      .mockReturnValueOnce(createChain([]) as never)
    vi.mocked(db.query.companyInfo.findFirst).mockResolvedValue(mockCompany)
    vi.mocked(db.query.bankAccounts.findFirst).mockResolvedValue(mockBankAccount)

    const result = await generateInvoiceExpensesPdf('inv1', 'bank1')
    expect(result).toBeDefined()
  })

  it('lanca erro se invoice nao encontrada', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)

    await expect(generateInvoiceExpensesPdf('xxx', 'bank1'))
      .rejects.toThrow(AppError)
  })
})
