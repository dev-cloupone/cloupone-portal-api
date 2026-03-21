import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as consultantService from '../services/consultant.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';
import { AppError } from '../utils/app-error';

const userIdSchema = z.string().uuid();

const createConsultantSchema = z.object({
  userId: z.string().uuid(V.uuidInvalid('Usuário')),
  hourlyRate: z.number().positive(V.greaterThanZero),
  contractType: z.enum(['clt', 'pj', 'horista'], { message: V.enumInvalid('Tipo de Contrato') }),
  allowOverlappingEntries: z.boolean().optional(),
});

const updateConsultantSchema = z.object({
  hourlyRate: z.number().positive(V.greaterThanZero).optional(),
  contractType: z.enum(['clt', 'pj', 'horista'], { message: V.enumInvalid('Tipo de Contrato') }).optional(),
  allowOverlappingEntries: z.boolean().optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await consultantService.listConsultants({ page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getByUserId: RequestHandler = async (req, res, next) => {
  try {
    const profile = await consultantService.getConsultantByUserId(userIdSchema.parse(req.params.userId));
    res.json(profile);
  } catch (err) {
    next(err);
  }
};

const create: RequestHandler = async (req, res, next) => {
  try {
    const data = createConsultantSchema.parse(req.body);
    const profile = await consultantService.createConsultant(data);
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const data = updateConsultantSchema.parse(req.body);
    const profile = await consultantService.updateConsultant(userIdSchema.parse(req.params.userId), data);
    res.json(profile);
  } catch (err) {
    next(err);
  }
};

const listProjects: RequestHandler = async (req, res, next) => {
  try {
    const userId = userIdSchema.parse(req.params.userId);
    // Consultors can only list their own projects; admins/gestores can list any
    if (req.userRole === 'consultor' && req.userId !== userId) {
      return next(new AppError('Acesso negado.', 403));
    }
    const data = await consultantService.listConsultantProjects(userId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

export const consultantController = { list, getByUserId, create, update, listProjects };
