import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as phaseService from '../services/phase.service';
import * as subphaseService from '../services/subphase.service';
import * as timeEntryService from '../services/time-entry.service';
import { V } from '../utils/validation-messages';
import { paginationSchema } from '../utils/pagination';

const idSchema = z.string().uuid();

// --- Fases ---

const createPhaseSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)),
  description: z.string().optional(),
});

const updatePhaseSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)).optional(),
  description: z.string().optional(),
  order: z.number().int(V.integer).min(0).optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
});

const listPhases: RequestHandler = async (req, res, next) => {
  try {
    const data = await phaseService.listPhases(idSchema.parse(req.params.projectId));
    res.json({ data });
  } catch (err) { next(err); }
};

const createPhase: RequestHandler = async (req, res, next) => {
  try {
    const data = createPhaseSchema.parse(req.body);
    const phase = await phaseService.createPhase(idSchema.parse(req.params.projectId), data);
    res.status(201).json(phase);
  } catch (err) { next(err); }
};

const updatePhase: RequestHandler = async (req, res, next) => {
  try {
    const data = updatePhaseSchema.parse(req.body);
    const phase = await phaseService.updatePhase(idSchema.parse(req.params.phaseId), data);
    res.json(phase);
  } catch (err) { next(err); }
};

const deactivatePhase: RequestHandler = async (req, res, next) => {
  try {
    const phase = await phaseService.deactivatePhase(idSchema.parse(req.params.phaseId));
    res.json(phase);
  } catch (err) { next(err); }
};

const reorderPhases: RequestHandler = async (req, res, next) => {
  try {
    const { orderedIds } = reorderSchema.parse(req.body);
    const result = await phaseService.reorderPhases(idSchema.parse(req.params.projectId), orderedIds);
    res.json(result);
  } catch (err) { next(err); }
};

// --- Subfases ---

const createSubphaseSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)),
  description: z.string().optional(),
  estimatedHours: z.number().positive(V.greaterThanZero).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid).optional(),
  businessDays: z.number().int(V.integer).positive(V.greaterThanZero).optional(),
});

const updateSubphaseSchema = z.object({
  name: z.string().min(2, V.min('Nome', 2)).max(255, V.max('Nome', 255)).optional(),
  description: z.string().optional(),
  estimatedHours: z.number().positive(V.greaterThanZero).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid).optional(),
  businessDays: z.number().int(V.integer).positive(V.greaterThanZero).optional(),
  order: z.number().int(V.integer).min(0).optional(),
});

const statusSchema = z.object({
  status: z.enum(['planned', 'in_progress', 'completed'], { message: V.enumInvalid('Status') }),
});

const listSubphases: RequestHandler = async (req, res, next) => {
  try {
    const data = await subphaseService.listSubphases(idSchema.parse(req.params.phaseId));
    res.json({ data });
  } catch (err) { next(err); }
};

const createSubphase: RequestHandler = async (req, res, next) => {
  try {
    const data = createSubphaseSchema.parse(req.body);
    const subphase = await subphaseService.createSubphase(idSchema.parse(req.params.phaseId), data);
    res.status(201).json(subphase);
  } catch (err) { next(err); }
};

const updateSubphase: RequestHandler = async (req, res, next) => {
  try {
    const data = updateSubphaseSchema.parse(req.body);
    const subphase = await subphaseService.updateSubphase(idSchema.parse(req.params.subphaseId), data);
    res.json(subphase);
  } catch (err) { next(err); }
};

const updateSubphaseStatus: RequestHandler = async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const subphase = await subphaseService.updateSubphaseStatus(idSchema.parse(req.params.subphaseId), status);
    res.json(subphase);
  } catch (err) { next(err); }
};

const deactivateSubphase: RequestHandler = async (req, res, next) => {
  try {
    const subphase = await subphaseService.deactivateSubphase(idSchema.parse(req.params.subphaseId));
    res.json(subphase);
  } catch (err) { next(err); }
};

const reorderSubphases: RequestHandler = async (req, res, next) => {
  try {
    const { orderedIds } = reorderSchema.parse(req.body);
    const result = await subphaseService.reorderSubphases(idSchema.parse(req.params.phaseId), orderedIds);
    res.json(result);
  } catch (err) { next(err); }
};

const listAvailableSubphases: RequestHandler = async (req, res, next) => {
  try {
    const projectId = idSchema.parse(req.params.projectId);
    const userId = req.userId!;
    const data = await subphaseService.listAvailableForTimeEntry(projectId, userId);
    res.json({ data });
  } catch (err) { next(err); }
};

const phasesDashboard: RequestHandler = async (_req, res, next) => {
  try {
    const data = await phaseService.getPhasesDashboard();
    res.json(data);
  } catch (err) { next(err); }
};

// --- Apontamentos por fase/subfase ---

const timeEntriesQuerySchema = paginationSchema.extend({
  userId: z.string().uuid(V.uuidInvalid('Usuário')).optional(),
  subphaseId: z.string().uuid(V.uuidInvalid('Subfase')).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid).optional(),
});

const listSubphaseTimeEntries: RequestHandler = async (req, res, next) => {
  try {
    const subphaseId = idSchema.parse(req.params.subphaseId);
    const { page, limit, userId, from, to } = timeEntriesQuerySchema.parse(req.query);
    const result = await timeEntryService.listSubphaseTimeEntries(subphaseId, { page, limit, userId, from, to });
    res.json(result);
  } catch (err) { next(err); }
};

const listPhaseTimeEntries: RequestHandler = async (req, res, next) => {
  try {
    const phaseId = idSchema.parse(req.params.phaseId);
    const { page, limit, userId, subphaseId, from, to } = timeEntriesQuerySchema.parse(req.query);
    const result = await timeEntryService.listPhaseTimeEntries(phaseId, { page, limit, userId, subphaseId, from, to });
    res.json(result);
  } catch (err) { next(err); }
};

export const phaseController = {
  listPhases, createPhase, updatePhase, deactivatePhase, reorderPhases,
  listSubphases, createSubphase, updateSubphase, updateSubphaseStatus, deactivateSubphase, reorderSubphases,
  listAvailableSubphases,
  phasesDashboard,
  listSubphaseTimeEntries,
  listPhaseTimeEntries,
};
