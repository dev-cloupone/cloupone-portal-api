import { vi } from 'vitest'

export function createChain(result: unknown[] = []) {
  const promise = Promise.resolve(result)
  const chain = {
    from: vi.fn(), where: vi.fn(), limit: vi.fn(), leftJoin: vi.fn(),
    innerJoin: vi.fn(), orderBy: vi.fn(), returning: vi.fn(), groupBy: vi.fn(),
    offset: vi.fn(), set: vi.fn(), values: vi.fn(), onConflictDoUpdate: vi.fn(),
    then: promise.then.bind(promise), catch: promise.catch.bind(promise),
  }
  Object.values(chain).forEach(fn => {
    if (typeof fn === 'function' && 'mockReturnValue' in fn) fn.mockReturnValue(chain)
  })
  return chain
}
