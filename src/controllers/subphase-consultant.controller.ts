import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as consultantService from '../services/subphase-consultant.service';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const addConsultantSchema = z.object({
  userId: z.string().uuid(V.uuidInvalid('Usuário')),
  estimatedHours: z.number().positive(V.greaterThanZero).optional(),
});

const updateHoursSchema = z.object({
  estimatedHours: z.number().positive(V.greaterThanZero),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const data = await consultantService.listConsultants(idSchema.parse(req.params.subphaseId));
    res.json({ data });
  } catch (err) { next(err); }
};

const add: RequestHandler = async (req, res, next) => {
  try {
    const { userId, estimatedHours } = addConsultantSchema.parse(req.body);
    const result = await consultantService.addConsultant(idSchema.parse(req.params.subphaseId), userId, estimatedHours);
    res.status(201).json(result);
  } catch (err) { next(err); }
};

const updateHours: RequestHandler = async (req, res, next) => {
  try {
    const { estimatedHours } = updateHoursSchema.parse(req.body);
    const result = await consultantService.updateConsultantHours(
      idSchema.parse(req.params.subphaseId),
      idSchema.parse(req.params.userId),
      estimatedHours,
    );
    res.json(result);
  } catch (err) { next(err); }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    const result = await consultantService.removeConsultant(
      idSchema.parse(req.params.subphaseId),
      idSchema.parse(req.params.userId),
    );
    res.json(result);
  } catch (err) { next(err); }
};

const loadConsultants: RequestHandler = async (req, res, next) => {
  try {
    const result = await consultantService.loadConsultants(idSchema.parse(req.params.phaseId));
    res.json(result);
  } catch (err) { next(err); }
};

export const subphaseConsultantController = { list, add, updateHours, remove, loadConsultants };
