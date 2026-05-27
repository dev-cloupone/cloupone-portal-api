import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/time-entry.service', () => ({
  getMonthEntries: vi.fn(),
  getWeekEntries: vi.fn(),
  upsertTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
  listTimeEntries: vi.fn(),
  listForView: vi.fn(),
}))

import * as timeEntryService from '../../services/time-entry.service'
import { timeEntryController } from '../time-entry.controller'

function createMocks(overrides: {
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  params?: Record<string, string>
  userId?: string
  userRole?: string
} = {}) {
  const req = {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    userId: overrides.userId ?? 'user-1',
    userRole: overrides.userRole ?? 'consultor',
  } as unknown as Request

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response

  const next = vi.fn() as unknown as NextFunction

  return { req, res, next }
}

describe('timeEntryController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getMonthEntries', () => {
    it('delegates to timeEntryService.getMonthEntries', async () => {
      const entries = { data: [{ id: 'e1' }], summary: {} }
      vi.mocked(timeEntryService.getMonthEntries).mockResolvedValue(entries as never)

      const { req, res, next } = createMocks({
        query: { date: '2025-01' },
        userId: 'user-1',
      })

      await timeEntryController.getMonthEntries(req, res, next)

      expect(timeEntryService.getMonthEntries).toHaveBeenCalledWith('user-1', '2025-01')
      expect(res.json).toHaveBeenCalledWith(entries)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('upsertTimeEntry', () => {
    it('delegates to timeEntryService.upsertTimeEntry', async () => {
      const entry = { id: 'e1', projectId: 'p1' }
      vi.mocked(timeEntryService.upsertTimeEntry).mockResolvedValue(entry as never)

      const { req, res, next } = createMocks({
        body: {
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          date: '2025-01-15',
          startTime: '09:00',
          endTime: '12:00',
          description: 'Work',
        },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await timeEntryController.upsert(req, res, next)

      expect(timeEntryService.upsertTimeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          userRole: 'consultor',
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          date: '2025-01-15',
          startTime: '09:00',
          endTime: '12:00',
        }),
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(entry)
    })
  })

  describe('deleteTimeEntry', () => {
    it('delegates to timeEntryService.deleteTimeEntry', async () => {
      vi.mocked(timeEntryService.deleteTimeEntry).mockResolvedValue(undefined as never)

      const entryId = '550e8400-e29b-41d4-a716-446655440000'
      const { req, res, next } = createMocks({
        params: { id: entryId },
        userId: 'user-1',
      })

      await timeEntryController.remove(req, res, next)

      expect(timeEntryService.deleteTimeEntry).toHaveBeenCalledWith(entryId, 'user-1')
      expect(res.status).toHaveBeenCalledWith(204)
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('getWeekEntries', () => {
    it('delegates to timeEntryService.getWeekEntries', async () => {
      const entries = { data: [{ id: 'e1' }] }
      vi.mocked(timeEntryService.getWeekEntries).mockResolvedValue(entries as never)

      const { req, res, next } = createMocks({
        query: { date: '2025-01-15' },
        userId: 'user-1',
      })

      await timeEntryController.getWeekEntries(req, res, next)

      expect(timeEntryService.getWeekEntries).toHaveBeenCalledWith('user-1', '2025-01-15')
      expect(res.json).toHaveBeenCalledWith(entries)
    })

    it('calls next on invalid date format', async () => {
      const { req, res, next } = createMocks({
        query: { date: 'invalid' },
        userId: 'user-1',
      })

      await timeEntryController.getWeekEntries(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('delegates to timeEntryService.listTimeEntries with pagination and filters', async () => {
      const result = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }
      vi.mocked(timeEntryService.listTimeEntries).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        query: { page: '1', limit: '20', userId: 'u2', projectId: 'p1', from: '2025-01-01', to: '2025-01-31' },
      })

      await timeEntryController.list(req, res, next)

      expect(timeEntryService.listTimeEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 20,
          userId: 'u2',
          projectId: 'p1',
          from: '2025-01-01',
          to: '2025-01-31',
        }),
      )
      expect(res.json).toHaveBeenCalledWith(result)
    })
  })

  describe('listView', () => {
    it('delegates to timeEntryService.listForView', async () => {
      const result = { entries: [], summary: {} }
      vi.mocked(timeEntryService.listForView).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        query: { month: '2025-01', consultantId: 'u1', projectId: 'p1', all: 'true' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await timeEntryController.listView(req, res, next)

      expect(timeEntryService.listForView).toHaveBeenCalledWith(
        expect.objectContaining({
          month: '2025-01',
          consultantId: 'u1',
          projectId: 'p1',
          all: true,
        }),
        'user-1',
        'super_admin',
      )
      expect(res.json).toHaveBeenCalledWith(result)
    })

    it('returns 400 when month param is missing', async () => {
      const { req, res, next } = createMocks({
        query: {},
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await timeEntryController.listView(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'month param required (YYYY-MM)' })
    })

    it('returns 400 when month param has invalid format', async () => {
      const { req, res, next } = createMocks({
        query: { month: 'invalid' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await timeEntryController.listView(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
    })
  })

  describe('getMonthEntries - validation', () => {
    it('calls next on invalid month format', async () => {
      const { req, res, next } = createMocks({
        query: { date: 'not-a-month' },
        userId: 'user-1',
      })

      await timeEntryController.getMonthEntries(req, res, next)

      expect(next).toHaveBeenCalled()
    })
  })

  describe('upsertTimeEntry - validation', () => {
    it('calls next on invalid body', async () => {
      const { req, res, next } = createMocks({
        body: { projectId: 'not-a-uuid' },
        userId: 'user-1',
      })

      await timeEntryController.upsert(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(timeEntryService.upsertTimeEntry).not.toHaveBeenCalled()
    })
  })
})
