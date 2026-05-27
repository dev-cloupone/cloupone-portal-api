import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChain } from '../../__test-utils__/drizzle-chain'
import { AppError } from '../../utils/app-error'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn((_col: unknown, val: unknown) => ({ type: 'ilike', val })),
  count: vi.fn(() => 'count'),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
}))

vi.mock('../../db/schema', () => ({
  clients: {
    id: 'id', companyName: 'companyName', cnpj: 'cnpj',
    contactName: 'contactName', contactEmail: 'contactEmail',
    contactPhone: 'contactPhone', notes: 'notes',
    address: 'address', city: 'city', state: 'state', zipCode: 'zipCode',
    isActive: 'isActive', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
}))

vi.mock('../../utils/pagination', () => ({
  buildMeta: vi.fn((total: number, params: { page: number; limit: number }) => ({
    page: params.page, limit: params.limit, total, totalPages: Math.ceil(total / params.limit),
  })),
}))

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

import {
  createClient, updateClient, deactivateClient, listClients,
} from '../client.service'
import { db } from '../../db'

const mockClient = {
  id: 'c1', companyName: 'Acme Corp', cnpj: '12345678000100',
  contactName: 'Joao', contactEmail: 'joao@acme.com', contactPhone: '11999999999',
  notes: null, address: 'Rua A', city: 'SP', state: 'SP', zipCode: '01001000',
  isActive: true, createdAt: new Date(), updatedAt: new Date(),
}

describe('createClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creates client with valid data', async () => {
    // CNPJ check: no existing client
    const selectChain = createChain([])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const created = { ...mockClient, id: 'c-new' }
    const insertChain = createChain([created])
    vi.mocked(db.insert).mockReturnValue(insertChain as never)

    const result = await createClient({
      companyName: 'Acme Corp', cnpj: '12345678000100',
    })
    expect(result).toEqual(created)
    expect(db.insert).toHaveBeenCalled()
  })

  it('throws 409 for duplicate CNPJ', async () => {
    const selectChain = createChain([{ id: 'c-existing' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    await expect(
      createClient({ companyName: 'Nova Corp', cnpj: '12345678000100' }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('updateClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('updates partial fields', async () => {
    // Existing client found
    const selectChain = createChain([{ id: 'c1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const updated = { ...mockClient, companyName: 'Acme Corp Ltda' }
    const updateChain = createChain([updated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await updateClient('c1', { companyName: 'Acme Corp Ltda' })
    expect(result).toEqual(updated)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when client not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(updateClient('invalid', { companyName: 'X' })).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 for CNPJ taken by another client', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(createChain([{ id: 'c1' }]) as never) // client exists
      .mockReturnValueOnce(createChain([{ id: 'c-other' }]) as never) // CNPJ taken by c-other
    await expect(updateClient('c1', { cnpj: '99999999000199' })).rejects.toMatchObject({ status: 409 })
  })
})

describe('deactivateClient', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('deactivates client (soft delete)', async () => {
    const selectChain = createChain([{ id: 'c1' }])
    vi.mocked(db.select).mockReturnValue(selectChain as never)

    const deactivated = { ...mockClient, isActive: false }
    const updateChain = createChain([deactivated])
    vi.mocked(db.update).mockReturnValue(updateChain as never)

    const result = await deactivateClient('c1')
    expect(result.isActive).toBe(false)
    expect(db.update).toHaveBeenCalled()
  })

  it('throws 404 when client not found', async () => {
    vi.mocked(db.select).mockReturnValue(createChain([]) as never)
    await expect(deactivateClient('invalid')).rejects.toMatchObject({ status: 404 })
  })
})

describe('listClients', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns correct pagination', async () => {
    const dataChain = createChain([mockClient])
    const countChain = createChain([{ total: 30 }])
    vi.mocked(db.select)
      .mockReturnValueOnce(dataChain as never)
      .mockReturnValueOnce(countChain as never)

    const result = await listClients({ page: 2, limit: 10 })
    expect(result.data).toEqual([mockClient])
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 30, totalPages: 3 })
  })
})
