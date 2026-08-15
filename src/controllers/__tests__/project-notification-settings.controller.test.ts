import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/project-notification-settings.service', () => ({
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  getEmails: vi.fn(),
  addEmail: vi.fn(),
  removeEmail: vi.fn(),
}))

import * as settingsService from '../../services/project-notification-settings.service'
import { projectNotificationSettingsController as ctrl } from '../project-notification-settings.controller'

function createMocks(overrides: Record<string, unknown> = {}) {
  const req = {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? { projectId: '550e8400-e29b-41d4-a716-446655440001' },
    userId: overrides.userId ?? 'u1',
  } as unknown as Request

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response

  const next = vi.fn() as unknown as NextFunction

  return { req, res, next }
}

describe('projectNotificationSettingsController', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('getSettings', () => {
    it('calls service and returns 200', async () => {
      const data = [{ userId: 'u1', channelEmail: true, channelInApp: true }]
      vi.mocked(settingsService.getSettings).mockResolvedValue(data as never)

      const { req, res, next } = createMocks({ query: { eventType: 'ticket_created' } })
      await ctrl.getSettings(req, res, next)

      expect(settingsService.getSettings).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001', 'ticket_created')
      expect(res.json).toHaveBeenCalledWith({ data })
    })
  })

  describe('upsertSettings', () => {
    it('validates body and calls service', async () => {
      vi.mocked(settingsService.upsertSettings).mockResolvedValue(undefined)

      const settings = [{ userId: '550e8400-e29b-41d4-a716-446655440000', eventType: 'ticket_created', channelEmail: true, channelInApp: false }]
      const { req, res, next } = createMocks({ body: { settings } })
      await ctrl.upsertSettings(req, res, next)

      expect(settingsService.upsertSettings).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001', settings)
      expect(res.json).toHaveBeenCalledWith({ success: true })
    })

    it('rejects invalid body (400)', async () => {
      const { req, res, next } = createMocks({ body: {} })
      await ctrl.upsertSettings(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(settingsService.upsertSettings).not.toHaveBeenCalled()
    })
  })

  describe('addEmail', () => {
    it('validates email and calls service', async () => {
      vi.mocked(settingsService.addEmail).mockResolvedValue({ id: 'e1', email: 'test@test.com', eventType: 'ticket_created', projectId: '550e8400-e29b-41d4-a716-446655440001', createdAt: new Date() } as never)

      const { req, res, next } = createMocks({ body: { email: 'test@test.com' } })
      await ctrl.addEmail(req, res, next)

      expect(settingsService.addEmail).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440001', 'test@test.com', 'ticket_created')
      expect(res.status).toHaveBeenCalledWith(201)
    })

    it('rejects invalid email (400)', async () => {
      const { req, res, next } = createMocks({ body: { email: 'not-an-email' } })
      await ctrl.addEmail(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(settingsService.addEmail).not.toHaveBeenCalled()
    })
  })

  describe('removeEmail', () => {
    it('calls service with id from params', async () => {
      vi.mocked(settingsService.removeEmail).mockResolvedValue(undefined)

      const { req, res, next } = createMocks({ params: { projectId: '550e8400-e29b-41d4-a716-446655440001', id: '550e8400-e29b-41d4-a716-446655440000' } })
      await ctrl.removeEmail(req, res, next)

      expect(settingsService.removeEmail).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000')
      expect(res.json).toHaveBeenCalledWith({ success: true })
    })
  })
})
