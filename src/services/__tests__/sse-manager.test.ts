import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Response } from 'express'

import { sseManager } from '../sse-manager'

function createMockResponse() {
  return { write: vi.fn() } as unknown as Response
}

describe('SSEManager', () => {
  beforeEach(() => {
    // Reset internal state
    ;(sseManager as any).connections = new Map()
  })

  it('addConnection registers a connection for userId', () => {
    const res = createMockResponse()
    sseManager.addConnection('u1', res)
    expect(sseManager.getConnectionCount()).toBe(1)
  })

  it('addConnection supports multiple connections per userId', () => {
    const res1 = createMockResponse()
    const res2 = createMockResponse()
    sseManager.addConnection('u1', res1)
    sseManager.addConnection('u1', res2)
    expect(sseManager.getConnectionCount()).toBe(2)
  })

  it('removeConnection removes a specific connection', () => {
    const res1 = createMockResponse()
    const res2 = createMockResponse()
    sseManager.addConnection('u1', res1)
    sseManager.addConnection('u1', res2)
    sseManager.removeConnection('u1', res1)
    expect(sseManager.getConnectionCount()).toBe(1)
  })

  it('removeConnection cleans up entry if last connection removed', () => {
    const res = createMockResponse()
    sseManager.addConnection('u1', res)
    sseManager.removeConnection('u1', res)
    expect(sseManager.getConnectionCount()).toBe(0)
  })

  it('send writes to all connections of userId', () => {
    const res1 = createMockResponse()
    const res2 = createMockResponse()
    sseManager.addConnection('u1', res1)
    sseManager.addConnection('u1', res2)

    sseManager.send('u1', { type: 'test' })

    expect(res1.write).toHaveBeenCalledWith('data: {"type":"test"}\n\n')
    expect(res2.write).toHaveBeenCalledWith('data: {"type":"test"}\n\n')
  })

  it('send does nothing for userId without connections', () => {
    expect(() => sseManager.send('u-nonexistent', { type: 'test' })).not.toThrow()
  })

  it('heartbeat sends to all connections', () => {
    const res1 = createMockResponse()
    const res2 = createMockResponse()
    sseManager.addConnection('u1', res1)
    sseManager.addConnection('u2', res2)

    sseManager.heartbeat()

    expect(res1.write).toHaveBeenCalledWith(': heartbeat\n\n')
    expect(res2.write).toHaveBeenCalledWith(': heartbeat\n\n')
  })
})
