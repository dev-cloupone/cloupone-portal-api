import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as templateService from '../services/expense-template.service';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const templateSchema = z.object({
  name: z.string().min(1, V.required('Nome')).max(100, V.max('Nome', 100)),
  expenseCategoryId: z.string().uuid(V.uuidInvalid('Categoria')).nullable().optional(),
  description: z.string().max(500, V.max('Descrição', 500)).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido').optional(),
  requiresReimbursement: z.boolean().optional(),
});

const updateTemplateSchema = templateSchema.partial();

const list: RequestHandler = async (req, res, next) => {
  try {
    const data = await templateService.listTemplates(req.userId!);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = templateSchema.parse(req.body);
    const template = await templateService.createTemplate(req.userId!, data);
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateTemplateSchema.parse(req.body);
    const template = await templateService.updateTemplate(idSchema.parse(req.params.id), req.userId!, data);
    res.json(template);
  } catch (err) {
    next(err);
  }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    await templateService.deleteTemplate(idSchema.parse(req.params.id), req.userId!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const expenseTemplateController = { list, create, update, remove };
