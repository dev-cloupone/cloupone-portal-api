import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as installmentService from '../services/installment.service';
import { V } from '../utils/validation-messages';

const projectIdSchema = z.string().uuid(V.uuidInvalid('Projeto'));
const idSchema = z.string().uuid();

const createInstallmentSchema = z.object({
  description: z.string().max(255).optional(),
  amount: z.number().positive(V.greaterThanZero),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').optional(),
});

const createBatchSchema = z.object({
  count: z.number().int().min(1).max(60),
  amount: z.number().positive(V.greaterThanZero),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').optional(),
});

const updateInstallmentSchema = z.object({
  description: z.string().max(255).optional(),
  amount: z.number().positive(V.greaterThanZero).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD').optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const data = await installmentService.listByProject(projectId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const body = createInstallmentSchema.parse(req.body);
    const result = await installmentService.create(projectId, {
      description: body.description,
      amount: String(body.amount),
      dueDate: body.dueDate,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const createBatch: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const body = createBatchSchema.parse(req.body);
    const result = await installmentService.createBatch(projectId, {
      count: body.count,
      amount: String(body.amount),
      startDate: body.startDate,
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const id = idSchema.parse(req.params.id);
    const body = updateInstallmentSchema.parse(req.body);
    const result = await installmentService.update(projectId, id, {
      description: body.description,
      amount: body.amount != null ? String(body.amount) : undefined,
      dueDate: body.dueDate,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const id = idSchema.parse(req.params.id);
    await installmentService.remove(projectId, id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const installmentController = { list, create, createBatch, update, remove };
