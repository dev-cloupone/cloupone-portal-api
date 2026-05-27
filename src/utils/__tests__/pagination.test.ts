import { describe, it, expect } from 'vitest'
import { paginationSchema, buildMeta } from '../pagination'

describe('paginationSchema', () => {
  it('applies defaults (page=1, limit=20) when not provided', () => {
    const result = paginationSchema.parse({})
    expect(result).toEqual({ page: 1, limit: 20 })
  })

  it('coerces strings to numbers', () => {
    const result = paginationSchema.parse({ page: '3', limit: '10' })
    expect(result).toEqual({ page: 3, limit: 10 })
  })

  it('rejects page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow()
    expect(() => paginationSchema.parse({ page: -1 })).toThrow()
  })

  it('rejects limit < 1', () => {
    expect(() => paginationSchema.parse({ limit: 0 })).toThrow()
    expect(() => paginationSchema.parse({ limit: -1 })).toThrow()
  })

  it('caps limit at 100', () => {
    expect(() => paginationSchema.parse({ limit: 101 })).toThrow()
  })
})

describe('buildMeta', () => {
  it('calculates totalPages correctly (e.g. 25 items, limit 10 = 3 pages)', () => {
    const meta = buildMeta(25, { page: 1, limit: 10 })
    expect(meta.totalPages).toBe(3)
  })

  it('returns totalPages=0 for total=0', () => {
    const meta = buildMeta(0, { page: 1, limit: 20 })
    expect(meta.totalPages).toBe(0)
  })

  it('returns page and limit in meta', () => {
    const meta = buildMeta(50, { page: 2, limit: 10 })
    expect(meta.page).toBe(2)
    expect(meta.limit).toBe(10)
    expect(meta.total).toBe(50)
  })

  it('calculates ceiling correctly (e.g. 21 items, limit 10 = 3 pages)', () => {
    const meta = buildMeta(21, { page: 1, limit: 10 })
    expect(meta.totalPages).toBe(3)
  })
})
