import { describe, it, expect, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  sql: vi.fn(),
}))

vi.mock('../../db', () => ({
  db: {},
}))

import { getNextInvoiceNumber } from '../invoice-utils'

describe('getNextInvoiceNumber', () => {
  it('retorna proximo valor da sequencia como number', async () => {
    const mockTx = {
      execute: vi.fn().mockResolvedValue({ rows: [{ nextval: '42' }] }),
    }

    const result = await getNextInvoiceNumber(mockTx as any)

    expect(result).toBe(42)
    expect(typeof result).toBe('number')
    expect(mockTx.execute).toHaveBeenCalledTimes(1)
  })

  it('chama execute uma unica vez', async () => {
    const mockTx = {
      execute: vi.fn().mockResolvedValue({ rows: [{ nextval: '1' }] }),
    }

    await getNextInvoiceNumber(mockTx as any)

    expect(mockTx.execute).toHaveBeenCalledTimes(1)
  })
})
