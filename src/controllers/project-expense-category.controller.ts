import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as projectCategoryService from '../services/project-expense-category.service';
import { assertUserHasProjectAccess } from '../utils/project-access';

const projectIdSchema = z.string().uuid();
const idSchema = z.string().uuid();

const importCategorySchema = z.object({
  templateId: z.string().uuid(),
  maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  kmRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
});

const updateProjectCategorySchema = z.object({
  maxAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  kmRate: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  isActive: z.boolean().optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const data = await projectCategoryService.listByProject(projectId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const importFromTemplate: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const body = importCategorySchema.parse(req.body);
    const category = await projectCategoryService.importFromTemplate(
      projectId,
      body.templateId,
      { maxAmount: body.maxAmount, kmRate: body.kmRate },
    );
    res.status(201).json(category);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const id = idSchema.parse(req.params.id);
    const data = updateProjectCategorySchema.parse(req.body);
    const category = await projectCategoryService.updateProjectCategory(id, projectId, data);
    res.json(category);
  } catch (err) {
    next(err);
  }
};

const deactivate: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    await assertUserHasProjectAccess(req.userId!, req.userRole!, projectId);
    const id = idSchema.parse(req.params.id);
    const category = await projectCategoryService.deactivateProjectCategory(id, projectId);
    res.json(category);
  } catch (err) {
    next(err);
  }
};

export const projectExpenseCategoryController = { list, importFromTemplate, update, deactivate };
