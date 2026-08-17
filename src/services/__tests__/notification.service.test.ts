import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => ({ type: 'desc', col })),
  sql: vi.fn(),
  count: vi.fn(() => 'count'),
}))

vi.mock('../../db/schema', () => ({
  notifications: {
    id: 'id', userId: 'userId', type: 'type', title: 'title',
    body: 'body', link: 'link', isRead: 'isRead', metadata: 'metadata',
    createdAt: 'createdAt',
  },
}))

vi.mock('../sse-manager', () => ({
  sseManager: { send: vi.fn() },
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

import { listByUser, getUnreadCount, markAsRead, markAllAsRead, create } from '../notification.service'
import { db } from '../../db'
import { sseManager } from '../sse-manager'

describe('notification.service', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('listByUser', () => {
    it('returns paginated notifications', async () => {
      const countChain = createChain([{ total: 5 }])
      const dataChain = createChain([
        { id: 'n1', title: 'Test', isRead: false, createdAt: new Date() },
      ])
      vi.mocked(db.select)
        .mockReturnValueOnce(countChain as never)
        .mockReturnValueOnce(dataChain as never)

      const result = await listByUser('u1', { page: 1, limit: 10 })

      expect(result.data).toHaveLength(1)
      expect(result.meta).toEqual({ page: 1, limit: 10, total: 5, totalPages: 1 })
    })
  })

  describe('getUnreadCount', () => {
    it('returns count of unread notifications', async () => {
      const chain = createChain([{ total: 3 }])
      vi.mocked(db.select).mockReturnValueOnce(chain as never)

      const result = await getUnreadCount('u1')
      expect(result).toBe(3)
    })
  })

  describe('markAsRead', () => {
    it('updates notification for the correct user', async () => {
      const chain = createChain([{ id: 'n1', isRead: true }])
      vi.mocked(db.update).mockReturnValue(chain as never)

      const result = await markAsRead('n1', 'u1')
      expect(result).toEqual(expect.objectContaining({ id: 'n1' }))
    })
  })

  describe('markAllAsRead', () => {
    it('updates all unread notifications for user', async () => {
      const chain = createChain([])
      vi.mocked(db.update).mockReturnValue(chain as never)

      await markAllAsRead('u1')
      expect(db.update).toHaveBeenCalled()
    })
  })

  describe('create', () => {
    it('inserts notification and sends via SSE', async () => {
      const notification = { id: 'n1', userId: 'u1', type: 'ticket_created', title: 'New ticket' }
      const chain = createChain([notification])
      vi.mocked(db.insert).mockReturnValue(chain as never)

      const result = await create({ userId: 'u1', type: 'ticket_created', title: 'New ticket' })

      expect(result).toEqual(notification)
      expect(sseManager.send).toHaveBeenCalledWith('u1', notification)
    })
  })
})
