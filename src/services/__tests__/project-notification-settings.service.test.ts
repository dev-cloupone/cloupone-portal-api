import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((_col: unknown, vals: unknown[]) => ({ type: 'inArray', vals })),
}))

vi.mock('../../db/schema', () => ({
  users: { id: 'id', name: 'name', email: 'email', role: 'role' },
  projectAllocations: { id: 'id', projectId: 'projectId', userId: 'userId' },
  projectNotificationSettings: {
    id: 'id', projectId: 'projectId', userId: 'userId',
    eventType: 'eventType', channelEmail: 'channelEmail', channelInApp: 'channelInApp',
  },
  projectNotificationEmails: {
    id: 'id', projectId: 'projectId', email: 'email', eventType: 'eventType', createdAt: 'createdAt',
  },
}))

vi.mock('../../utils/app-error', () => ({
  appError: vi.fn((msg: unknown, status: number) => {
    const err = new Error(typeof msg === 'string' ? msg : (msg as { message: string }).message) as Error & { statusCode: number }
    err.statusCode = status
    return err
  }),
}))

import { createChain } from '../../__test-utils__/drizzle-chain'

vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import {
  getSettings, upsertSettings, getEmails, addEmail, removeEmail,
} from '../project-notification-settings.service'
import { db } from '../../db'

describe('project-notification-settings.service', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('getSettings', () => {
    it('returns allocated users with their notification settings', async () => {
      const chain = createChain([
        { userId: 'u1', userName: 'Maria', userEmail: 'maria@test.com', userRole: 'gestor', channelEmail: true, channelInApp: true },
        { userId: 'u2', userName: 'Pedro', userEmail: 'pedro@test.com', userRole: 'consultor', channelEmail: null, channelInApp: null },
      ])
      vi.mocked(db.select).mockReturnValueOnce(chain as never)

      const result = await getSettings('p1', 'ticket_created')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(expect.objectContaining({ userId: 'u1', channelEmail: true, channelInApp: true, eventType: 'ticket_created' }))
      expect(result[1]).toEqual(expect.objectContaining({ userId: 'u2', channelEmail: false, channelInApp: false, eventType: 'ticket_created' }))
    })

    it('returns empty array if no allocations', async () => {
      const chain = createChain([])
      vi.mocked(db.select).mockReturnValueOnce(chain as never)

      const result = await getSettings('p1', 'ticket_created')
      expect(result).toHaveLength(0)
    })
  })

  describe('upsertSettings', () => {
    it('upserts settings for allocated users', async () => {
      const allocChain = createChain([{ userId: 'u1' }])
      vi.mocked(db.select).mockReturnValueOnce(allocChain as never)

      const insertChain = createChain([])
      vi.mocked(db.insert).mockReturnValue(insertChain as never)

      await upsertSettings('p1', [
        { userId: 'u1', eventType: 'ticket_created', channelEmail: true, channelInApp: false },
      ])

      expect(db.insert).toHaveBeenCalled()
    })

    it('rejects userId not allocated to project', async () => {
      const allocChain = createChain([])
      vi.mocked(db.select).mockReturnValueOnce(allocChain as never)

      await expect(upsertSettings('p1', [
        { userId: 'u-invalid', eventType: 'ticket_created', channelEmail: true, channelInApp: true },
      ])).rejects.toThrow('Usuarios nao alocados ao projeto')
    })

    it('deletes settings when both channels are false', async () => {
      const allocChain = createChain([{ userId: 'u1' }])
      vi.mocked(db.select).mockReturnValueOnce(allocChain as never)

      const deleteChain = createChain([])
      vi.mocked(db.delete).mockReturnValue(deleteChain as never)

      await upsertSettings('p1', [
        { userId: 'u1', eventType: 'ticket_created', channelEmail: false, channelInApp: false },
      ])

      expect(db.delete).toHaveBeenCalled()
      expect(db.insert).not.toHaveBeenCalled()
    })

    it('does nothing for empty settings array', async () => {
      await upsertSettings('p1', [])
      expect(db.select).not.toHaveBeenCalled()
    })
  })

  describe('getEmails', () => {
    it('lists external emails for a project', async () => {
      const chain = createChain([
        { id: 'e1', email: 'ext@test.com', eventType: 'ticket_created', createdAt: new Date() },
      ])
      vi.mocked(db.select).mockReturnValueOnce(chain as never)

      const result = await getEmails('p1')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({ email: 'ext@test.com' }))
    })
  })

  describe('addEmail', () => {
    it('inserts a valid external email', async () => {
      const chain = createChain([{ id: 'e1', email: 'ext@test.com', eventType: 'ticket_created', projectId: 'p1', createdAt: new Date() }])
      vi.mocked(db.insert).mockReturnValue(chain as never)

      const result = await addEmail('p1', 'ext@test.com', 'ticket_created')
      expect(result).toEqual(expect.objectContaining({ email: 'ext@test.com' }))
    })
  })

  describe('removeEmail', () => {
    it('removes email by id', async () => {
      const chain = createChain([])
      vi.mocked(db.delete).mockReturnValue(chain as never)

      await removeEmail('e1')
      expect(db.delete).toHaveBeenCalled()
    })
  })
})
