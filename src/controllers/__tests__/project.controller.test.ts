import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Request, Response, NextFunction } from 'express'

vi.mock('../../services/project.service', () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProjectById: vi.fn(),
  updateProject: vi.fn(),
  deactivateProject: vi.fn(),
  listAllocations: vi.fn(),
  addAllocation: vi.fn(),
  removeAllocation: vi.fn(),
}))

vi.mock('../../utils/project-access', () => ({
  assertUserHasProjectAccess: vi.fn(),
}))

import * as projectService from '../../services/project.service'
import { assertUserHasProjectAccess } from '../../utils/project-access'
import { projectController } from '../project.controller'

function createMocks(overrides: {
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  params?: Record<string, string>
  userId?: string
  userRole?: string
  userClientId?: string | null
} = {}) {
  const req = {
    body: overrides.body ?? {},
    query: overrides.query ?? {},
    params: overrides.params ?? {},
    userId: overrides.userId ?? 'user-1',
    userRole: overrides.userRole ?? 'super_admin',
    userClientId: overrides.userClientId ?? null,
  } as unknown as Request

  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response

  const next = vi.fn() as unknown as NextFunction

  return { req, res, next }
}

describe('projectController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listProjects', () => {
    it('delegates to projectService.listProjects', async () => {
      const result = {
        data: [{ id: 'p1', name: 'Projeto A' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }
      vi.mocked(projectService.listProjects).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        query: { page: '1', limit: '20' },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await projectController.list(req, res, next)

      expect(projectService.listProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          limit: 20,
          userId: 'user-1',
          userRole: 'super_admin',
        }),
      )
      expect(res.json).toHaveBeenCalledWith(result)
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('createProject', () => {
    it('delegates to projectService.createProject', async () => {
      const project = { id: 'p1', name: 'Novo Projeto' }
      vi.mocked(projectService.createProject).mockResolvedValue(project as never)

      const { req, res, next } = createMocks({
        body: {
          name: 'Novo Projeto',
          clientId: '550e8400-e29b-41d4-a716-446655440000',
          billingRate: 150,
        },
      })

      await projectController.create(req, res, next)

      expect(projectService.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Novo Projeto',
          clientId: '550e8400-e29b-41d4-a716-446655440000',
          billingRate: 150,
        }),
      )
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(project)
    })

    it('calls next on validation error', async () => {
      const { req, res, next } = createMocks({
        body: { name: 'X', clientId: 'not-uuid', billingRate: -1 },
      })

      await projectController.create(req, res, next)

      expect(next).toHaveBeenCalled()
      expect(projectService.createProject).not.toHaveBeenCalled()
    })
  })

  describe('getById', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.getProjectById', async () => {
      const project = { id: validId, name: 'Projeto A' }
      vi.mocked(assertUserHasProjectAccess).mockResolvedValue(undefined)
      vi.mocked(projectService.getProjectById).mockResolvedValue(project as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await projectController.getById(req, res, next)

      expect(assertUserHasProjectAccess).toHaveBeenCalledWith('user-1', 'super_admin', validId, null)
      expect(projectService.getProjectById).toHaveBeenCalledWith(validId)
      expect(res.json).toHaveBeenCalledWith(project)
    })
  })

  describe('update', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.updateProject', async () => {
      const project = { id: validId, name: 'Updated' }
      vi.mocked(projectService.updateProject).mockResolvedValue(project as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        body: { name: 'Updated' },
      })

      await projectController.update(req, res, next)

      expect(projectService.updateProject).toHaveBeenCalledWith(validId, { name: 'Updated' })
      expect(res.json).toHaveBeenCalledWith(project)
    })
  })

  describe('deactivate', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.deactivateProject', async () => {
      const project = { id: validId, isActive: false }
      vi.mocked(projectService.deactivateProject).mockResolvedValue(project as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
      })

      await projectController.deactivate(req, res, next)

      expect(projectService.deactivateProject).toHaveBeenCalledWith(validId)
      expect(res.json).toHaveBeenCalledWith(project)
    })
  })

  describe('listAllocations', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.listAllocations', async () => {
      const data = [{ userId: 'u1', userName: 'User 1' }]
      vi.mocked(assertUserHasProjectAccess).mockResolvedValue(undefined)
      vi.mocked(projectService.listAllocations).mockResolvedValue(data as never)

      const { req, res, next } = createMocks({
        params: { id: validId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await projectController.listAllocations(req, res, next)

      expect(projectService.listAllocations).toHaveBeenCalledWith(validId)
      expect(res.json).toHaveBeenCalledWith({ data })
    })
  })

  describe('addAllocation', () => {
    const validProjectId = '550e8400-e29b-41d4-a716-446655440000'
    const validUserId = '660e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.addAllocation', async () => {
      const allocation = { id: 'a1', projectId: validProjectId, userId: validUserId }
      vi.mocked(assertUserHasProjectAccess).mockResolvedValue(undefined)
      vi.mocked(projectService.addAllocation).mockResolvedValue(allocation as never)

      const { req, res, next } = createMocks({
        params: { id: validProjectId },
        body: { userId: validUserId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await projectController.addAllocation(req, res, next)

      expect(projectService.addAllocation).toHaveBeenCalledWith(validProjectId, validUserId)
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(allocation)
    })
  })

  describe('removeAllocation', () => {
    const validProjectId = '550e8400-e29b-41d4-a716-446655440000'
    const validUserId = '660e8400-e29b-41d4-a716-446655440000'

    it('delegates to projectService.removeAllocation', async () => {
      const result = { success: true }
      vi.mocked(assertUserHasProjectAccess).mockResolvedValue(undefined)
      vi.mocked(projectService.removeAllocation).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        params: { id: validProjectId, userId: validUserId },
        userId: 'user-1',
        userRole: 'super_admin',
      })

      await projectController.removeAllocation(req, res, next)

      expect(projectService.removeAllocation).toHaveBeenCalledWith(validProjectId, validUserId)
      expect(res.json).toHaveBeenCalledWith(result)
    })
  })

  describe('listProjects - client role', () => {
    it('uses userClientId when role is client', async () => {
      const result = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } }
      vi.mocked(projectService.listProjects).mockResolvedValue(result as never)

      const { req, res, next } = createMocks({
        query: { page: '1', limit: '20' },
        userId: 'user-1',
        userRole: 'client',
        userClientId: 'client-123',
      })

      await projectController.list(req, res, next)

      expect(projectService.listProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-123',
          userRole: 'client',
        }),
      )
    })
  })
})
