import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as timesheetLockService from '../services/timesheet-lock.service';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const lockDaysSchema = z.object({
  lockDays: z.number().int(V.integer).min(0).max(90).nullable(),
});

const getConfig: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.projectId);
    res.json(await timesheetLockService.getLockConfig(projectId));
  } catch (err) { next(err); }
};

const setLockDays: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.projectId);
    const { lockDays } = lockDaysSchema.parse(req.body);
    res.json(await timesheetLockService.setLockDays(projectId, lockDays));
  } catch (err) { next(err); }
};

export const projectTimesheetLockController = { getConfig, setLockDays };
