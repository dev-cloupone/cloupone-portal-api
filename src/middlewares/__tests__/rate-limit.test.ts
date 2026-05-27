import { describe, it, expect, vi } from 'vitest'

const { configs, mockIpKeyGenerator } = vi.hoisted(() => {
  const configs: Record<string, unknown>[] = []
  const mockIpKeyGenerator = vi.fn((_req: unknown) => '127.0.0.1')
  return { configs, mockIpKeyGenerator }
})

vi.mock('express-rate-limit', () => ({
  default: vi.fn((config: Record<string, unknown>) => {
    configs.push(config)
    return vi.fn()
  }),
  ipKeyGenerator: mockIpKeyGenerator,
}))

// Import triggers the mock calls
import '../rate-limit'

describe('rate-limit middlewares', () => {
  // Order: authSensitive(0), authGeneral(1), search(2), authenticated(3), global(4)

  it('authSensitiveRateLimit uses IP key (no custom keyGenerator)', () => {
    expect(configs[0]).not.toHaveProperty('keyGenerator')
  })

  it('authGeneralRateLimit uses IP key (no custom keyGenerator)', () => {
    expect(configs[1]).not.toHaveProperty('keyGenerator')
  })

  it('searchRateLimit uses userId key', () => {
    expect(configs[2]).toHaveProperty('keyGenerator')
    const keyGen = configs[2].keyGenerator as (req: unknown, res: unknown) => string
    expect(keyGen({ userId: 'user-123' }, {})).toBe('user-123')
  })

  it('authenticatedRateLimit uses userId key', () => {
    expect(configs[3]).toHaveProperty('keyGenerator')
  })

  it('globalRateLimit uses IP key (no custom keyGenerator)', () => {
    expect(configs[4]).not.toHaveProperty('keyGenerator')
  })

  it('uses fallback IP when userId is not available', () => {
    const keyGen = configs[2].keyGenerator as (req: unknown, res: unknown) => string
    expect(keyGen({ userId: undefined }, {})).toBe('127.0.0.1')
  })
})
