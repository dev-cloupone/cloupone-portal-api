import { describe, it, expect } from 'vitest'
import { calculateEndDate } from '../business-days'

describe('calculateEndDate', () => {
  it('advances N business days from Monday', () => {
    // 2024-01-08 = Monday, +5 business days = Monday 2024-01-15
    expect(calculateEndDate('2024-01-08', 5)).toBe('2024-01-15')
  })

  it('skips Saturday and Sunday correctly', () => {
    // 2024-01-12 = Friday, +1 business day = Monday 2024-01-15
    expect(calculateEndDate('2024-01-12', 1)).toBe('2024-01-15')
  })

  it('works with 0 business days (returns same date)', () => {
    expect(calculateEndDate('2024-01-08', 0)).toBe('2024-01-08')
  })

  it('handles month boundary crossing (e.g. Friday 28 + 3 business days)', () => {
    // 2024-06-28 = Friday, +3 business days = Wed 2024-07-03
    expect(calculateEndDate('2024-06-28', 3)).toBe('2024-07-03')
  })

  it('handles year boundary crossing', () => {
    // 2024-12-30 = Monday, +3 business days = Thu 2025-01-02
    expect(calculateEndDate('2024-12-30', 3)).toBe('2025-01-02')
  })

  it('returns ISO format (YYYY-MM-DD)', () => {
    const result = calculateEndDate('2024-01-08', 1)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
