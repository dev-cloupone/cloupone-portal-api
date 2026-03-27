import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as categoryService from '../services/expense-category.service';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const createCategorySchema = z.object({
  name: z.string().min(1, V.required('Nome')).max(100, V.max('Nome', 100)),
  description: z.string().max(255, V.max('Descrição', 255)).optional(),
  maxAmount: z.string().optional(),
  requiresReceipt: z.boolean().optional(),
  sortOrder: z.number().int(V.integer).optional(),
});

const updateCategorySchema = createCategorySchema.partial();

const list: RequestHandler = async (_req, res, next) => {
  try {
    const data = await categoryService.listCategories();
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const data = await categoryService.getCategoryById(idSchema.parse(req.params.id));
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(data);
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(idSchema.parse(req.params.id), data);
    res.json(category);
  } catch (err) {
    next(err);
  }
};

const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const category = await categoryService.deactivateCategory(idSchema.parse(req.params.id));
    res.json(category);
  } catch (err) {
    next(err);
  }
};

export const expenseCategoryController = { list, getById, create, update, deactivate };
