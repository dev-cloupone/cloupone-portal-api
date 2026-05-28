import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as rateService from '../services/consultant-rate.service';

const projectIdSchema = z.string().uuid();
const userIdSchema = z.string().uuid();

const upsertRateSchema = z.object({
  costRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
  billingRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.id);
    const data = await rateService.listByProject(projectId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const upsert: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.id);
    const userId = userIdSchema.parse(req.params.userId);
    const body = upsertRateSchema.parse(req.body);
    const rate = await rateService.upsert(projectId, userId, body);
    res.json(rate);
  } catch (err) {
    next(err);
  }
};

export const consultantRateController = { list, upsert };
