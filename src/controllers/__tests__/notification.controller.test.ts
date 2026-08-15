import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/notification.service', () => ({
  listByUser: vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
}))

vi.mock('../../services/sse-manager', () => ({
  sseManager: { addConnection: vi.fn(), removeConnection: vi.fn() },
}))

import * as notificationService from '../../services/notification.service'
import { sseManager } from '../../services/sse-manager'
import { notificationController as ctrl } from '../notification.controller'

function createMocks(overrides: Record<string, unknown> = {}) {
  const req = {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    userId: overrides.userId ?? 'u1',
    on: vi.fn(),
  } as unknown as Request

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    writeHead: vi.fn(),
    write: vi.fn(),
  } as unknown as Response

  const next = vi.fn() as unknown as NextFunction

  return { req, res, next }
}

describe('notificationController', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('list', () => {
    it('returns 200 with paginated notifications', async () => {
      const result = { data: [{ id: 'n1' }], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }
      vi.mocked(notificationService.listByUser).mockResolvedValue(result as never)

      const { req, res, next } = createMocks()
      await ctrl.list(req, res, next)

      expect(res.json).toHaveBeenCalledWith(result)
    })
  })

  describe('getUnreadCount', () => {
    it('returns 200 with count', async () => {
      vi.mocked(notificationService.getUnreadCount).mockResolvedValue(5)

      const { req, res, next } = createMocks()
      await ctrl.getUnreadCount(req, res, next)

      expect(res.json).toHaveBeenCalledWith({ count: 5 })
    })
  })

  describe('markAsRead', () => {
    it('returns 200', async () => {
      vi.mocked(notificationService.markAsRead).mockResolvedValue(undefined as never)

      const { req, res, next } = createMocks({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } })
      await ctrl.markAsRead(req, res, next)

      expect(res.json).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('markAllAsRead', () => {
    it('returns 200', async () => {
      vi.mocked(notificationService.markAllAsRead).mockResolvedValue(undefined)

      const { req, res, next } = createMocks()
      await ctrl.markAllAsRead(req, res, next)

      expect(res.json).toHaveBeenCalledWith({ success: true })
    })
  })

  describe('stream', () => {
    it('configures SSE headers and registers connection', () => {
      const { req, res, next } = createMocks()
      ctrl.stream(req, res, next)

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      expect(sseManager.addConnection).toHaveBeenCalledWith('u1', res)
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"type":"connected"'))
    })
  })
})
