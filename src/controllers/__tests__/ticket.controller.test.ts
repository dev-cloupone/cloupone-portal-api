import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/ticket.service', () => ({
  createTicket: vi.fn(),
  listTickets: vi.fn(),
  getTicketById: vi.fn(),
  updateTicket: vi.fn(),
  getTicketStats: vi.fn(),
  addComment: vi.fn(),
  listComments: vi.fn(),
  listHistory: vi.fn(),
  addAttachment: vi.fn(),
  listAttachments: vi.fn(),
  removeAttachment: vi.fn(),
  listTicketTimeEntries: vi.fn(),
}))

vi.mock('../../services/user.service', () => ({
  getUserClientId: vi.fn(),
}))

import * as ticketService from '../../services/ticket.service'
import { getUserClientId } from '../../services/user.service'
import { ticketController } from '../ticket.controller'

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

const validId = '550e8400-e29b-41d4-a716-446655440000'

describe('ticketController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createTicket', () => {
    const validBody = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'question' as const,
      title: 'Novo ticket de teste',
    }

    it('extracts userId and role from request', async () => {
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.createTicket).mockResolvedValue({ id: 't1' } as never)

      const { req, res, next } = createMocks({
        body: validBody,
        userId: 'user-42',
        userRole: 'client',
      })

      await ticketController.create(req, res, next)

      expect(getUserClientId).toHaveBeenCalledWith('user-42', 'client')
      expect(ticketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: 'user-42',
          createdByRole: 'client',
        }),
      )
    })

    it('delegates to ticketService.createTicket', async () => {
      const ticket = { id: 't1', title: 'Novo ticket de teste' }
      vi.mocked(getUserClientId).mockResolvedValue('client-1')
      vi.mocked(ticketService.createTicket).mockResolvedValue(ticket as never)

      const { req, res, next } = createMocks({
        body: validBody,
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.create(req, res, next)

      expect(ticketService.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: '550e8400-e29b-41d4-a716-446655440000',
          type: 'question',
          title: 'Novo ticket de teste',
          createdBy: 'user-1',
          createdByRole: 'consultor',
          createdByClientId: 'client-1',
        }),
      )
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(ticket)
    })
  })

  describe('listTickets', () => {
    it('applies pagination', async () => {
      const result = {
        data: [{ id: 't1' }],
        meta: { page: 2, limit: 10, total: 15, totalPages: 2 },
      }
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.listTickets).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        query: { page: '2', limit: '10' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await ticketController.list(req, res, next)

      expect(ticketService.listTickets).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 10,
          userId: 'user-1',
          userRole: 'super_admin',
        }),
      )
      expect(res.json).toHaveBeenCalledWith(result)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('getById', () => {
    it('delegates to ticketService.getTicketById', async () => {
      const ticket = { id: validId, title: 'Test Ticket' }
      vi.mocked(getUserClientId).mockResolvedValue('client-1')
      vi.mocked(ticketService.getTicketById).mockResolvedValue(ticket as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.getById(req, res, next)

      expect(ticketService.getTicketById).toHaveBeenCalledWith(validId, 'user-1', 'consultor', 'client-1')
      expect(res.json).toHaveBeenCalledWith(ticket)
    })
  })

  describe('update', () => {
    it('delegates to ticketService.updateTicket', async () => {
      const ticket = { id: validId, status: 'in_analysis' }
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.updateTicket).mockResolvedValue(ticket as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        body: { status: 'in_analysis' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await ticketController.update(req, res, next)

      expect(ticketService.updateTicket).toHaveBeenCalledWith(
        validId, 'user-1', 'super_admin', null, { status: 'in_analysis' },
      )
      expect(res.json).toHaveBeenCalledWith(ticket)
    })
  })

  describe('getStats', () => {
    it('delegates to ticketService.getTicketStats', async () => {
      const stats = { open: 5, closed: 3 }
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.getTicketStats).mockResolvedValue(stats as never)

      const { req, res, next } = createMocks({
        query: { projectId: 'p1' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await ticketController.getStats(req, res, next)

      expect(ticketService.getTicketStats).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          userRole: 'super_admin',
          projectId: 'p1',
        }),
      )
      expect(res.json).toHaveBeenCalledWith(stats)
    })
  })

  describe('addComment', () => {
    it('delegates to ticketService.addComment', async () => {
      const comment = { id: 'c1', content: 'Hello' }
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.addComment).mockResolvedValue(comment as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        body: { content: 'Hello' },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.addComment(req, res, next)

      expect(ticketService.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: validId,
          userId: 'user-1',
          userRole: 'consultor',
          content: 'Hello',
        }),
      )
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(comment)
    })
  })

  describe('listComments', () => {
    it('delegates to ticketService.listComments', async () => {
      const comments = [{ id: 'c1', content: 'Hello' }]
      vi.mocked(getUserClientId).mockResolvedValue('client-1')
      vi.mocked(ticketService.listComments).mockResolvedValue(comments as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.listComments(req, res, next)

      expect(ticketService.listComments).toHaveBeenCalledWith(validId, 'user-1', 'consultor', 'client-1')
      expect(res.json).toHaveBeenCalledWith(comments)
    })
  })

  describe('listHistory', () => {
    it('delegates to ticketService.listHistory', async () => {
      const history = [{ id: 'h1', action: 'created' }]
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.listHistory).mockResolvedValue(history as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await ticketController.listHistory(req, res, next)

      expect(ticketService.listHistory).toHaveBeenCalledWith(validId, 'user-1', 'super_admin', null)
      expect(res.json).toHaveBeenCalledWith(history)
    })
  })

  describe('addAttachment', () => {
    it('delegates to ticketService.addAttachment', async () => {
      const attachment = { id: 'att1', fileId: 'f1' }
      vi.mocked(getUserClientId).mockResolvedValue(null)
      vi.mocked(ticketService.addAttachment).mockResolvedValue(attachment as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        body: { fileId: 'f1' },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.addAttachment(req, res, next)

      expect(ticketService.addAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: validId,
          fileId: 'f1',
          uploadedBy: 'user-1',
          userRole: 'consultor',
        }),
      )
      expect(res.status).toHaveBeenCalledWith(201)
    })

    it('returns 400 when fileId is missing', async () => {
      const { req, res, next } = createMocks({
        params: { id: validId },
        body: {},
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.addAttachment(req, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ error: 'fileId é obrigatório.' })
    })
  })

  describe('listAttachments', () => {
    it('delegates to ticketService.listAttachments', async () => {
      const attachments = [{ id: 'att1' }]
      vi.mocked(ticketService.listAttachments).mockResolvedValue(attachments as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
      })

      await ticketController.listAttachments(req, res, next)

      expect(ticketService.listAttachments).toHaveBeenCalledWith(validId)
      expect(res.json).toHaveBeenCalledWith(attachments)
    })
  })

  describe('removeAttachment', () => {
    const attachmentId = '660e8400-e29b-41d4-a716-446655440000'

    it('delegates to ticketService.removeAttachment', async () => {
      vi.mocked(ticketService.removeAttachment).mockResolvedValue(undefined as never)

      const { req, res, next } = createMocks({
        params: { id: validId, attachmentId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await ticketController.removeAttachment(req, res, next)

      expect(ticketService.removeAttachment).toHaveBeenCalledWith(validId, attachmentId, 'user-1', 'super_admin')
      expect(res.status).toHaveBeenCalledWith(204)
      expect(res.send).toHaveBeenCalled()
    })
  })

  describe('listTimeEntries', () => {
    it('delegates to ticketService.listTicketTimeEntries', async () => {
      const entries = [{ id: 'te1' }]
      vi.mocked(getUserClientId).mockResolvedValue('client-1')
      vi.mocked(ticketService.listTicketTimeEntries).mockResolvedValue(entries as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'consultor',
      })

      await ticketController.listTimeEntries(req, res, next)

      expect(ticketService.listTicketTimeEntries).toHaveBeenCalledWith(validId, 'user-1', 'consultor', 'client-1')
      expect(res.json).toHaveBeenCalledWith(entries)
    })
  })
})
