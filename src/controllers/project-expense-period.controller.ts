import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as periodService from '../services/project-expense-period.service';
import { assertUserHasProjectAccess } from '../utils/project-access';

const projectIdSchema = z.string().uuid();
const idSchema = z.string().uuid();

const openPeriodSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

const listPeriodsSchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const filters = listPeriodsSchema.parse(req.query);
    const data = await periodService.listByProject(projectId, filters);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const openPeriod: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const body = openPeriodSchema.parse(req.body);
    const period = await periodService.openPeriod(projectId, body, req.userId!);
    res.status(201).json(period);
  } catch (err) {
    next(err);
  }
};

const closePeriod: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const periodId = idSchema.parse(req.params.id);
    const period = await periodService.closePeriod(periodId, projectId, req.userId!);
    res.json(period);
  } catch (err) {
    next(err);
  }
};

const reopenPeriod: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const periodId = idSchema.parse(req.params.id);
    const period = await periodService.reopenPeriod(periodId, projectId, req.userId!);
    res.json(period);
  } catch (err) {
    next(err);
  }
};

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (s) => !isNaN(new Date(s + 'T12:00:00').getTime()),
  { message: 'Data inválida' },
);

const updateDaysSchema = z.object({
  customDays: z.array(dateString).nullable(),
});

const updateDays: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const periodId = idSchema.parse(req.params.id);
    const body = updateDaysSchema.parse(req.body);
    const period = await periodService.updatePeriodDays(periodId, projectId, body, req.userId!);
    res.json(period);
  } catch (err) {
    next(err);
  }
};

export const projectExpensePeriodController = { list, openPeriod, closePeriod, reopenPeriod, updateDays };
