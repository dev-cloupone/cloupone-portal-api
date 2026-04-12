import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as projectService from '../services/project.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';
import { assertUserHasProjectAccess } from '../utils/project-access';

const idSchema = z.string().uuid();

const createProjectSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)),
  description: z.string().optional(),
  clientId: z.string().uuid(V.uuidInvalid('Cliente')),
  billingRate: z.number().positive(V.greaterThanZero),
  budgetHours: z.number().int(V.integer).positive(V.greaterThanZero).optional(),
  budgetType: z.enum(['monthly', 'total']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)).optional(),
  description: z.string().optional(),
  clientId: z.string().uuid(V.uuidInvalid('Cliente')).optional(),
  status: z.enum(['active', 'paused', 'finished']).optional(),
  billingRate: z.number().positive(V.greaterThanZero).optional(),
  budgetHours: z.number().int(V.integer).positive(V.greaterThanZero).optional(),
  budgetType: z.enum(['monthly', 'total']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const addAllocationSchema = z.object({
  userId: z.string().uuid(V.uuidInvalid('Usuário')),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    // Users with role 'user' can only see projects from their own client
    const clientId = req.userRole === 'user' ? req.userClientId ?? undefined : req.query.clientId as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await projectService.listProjects({ page, limit, clientId, status, userId: req.userId, userRole: req.userRole });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.id);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId, req.userClientId);
    const project = await projectService.getProjectById(projectId);
    res.json(project);
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createProjectSchema.parse(req.body);
    const project = await projectService.createProject(data);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateProjectSchema.parse(req.body);
    const project = await projectService.updateProject(idSchema.parse(req.params.id), data);
    res.json(project);
  } catch (err) {
    next(err);
  }
};

const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const project = await projectService.deactivateProject(idSchema.parse(req.params.id));
    res.json(project);
  } catch (err) {
    next(err);
  }
};

const listAllocations: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.id);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId, req.userClientId);
    const data = await projectService.listAllocations(projectId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const addAllocation: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.id);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId, req.userClientId);
    const { userId } = addAllocationSchema.parse(req.body);
    const allocation = await projectService.addAllocation(projectId, userId);
    res.status(201).json(allocation);
  } catch (err) {
    next(err);
  }
};

const removeAllocation: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.id);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId, req.userClientId);
    const result = await projectService.removeAllocation(
      projectId,
      idSchema.parse(req.params.userId),
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const projectController = { list, getById, create, update, deactivate, listAllocations, addAllocation, removeAllocation };
