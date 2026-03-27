import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as timeEntryService from '../services/time-entry.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const monthRegex = /^\d{4}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const upsertEntrySchema = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(V.uuidInvalid('Projeto')),
  categoryId: z.string().uuid(V.uuidInvalid('Categoria')).nullable().optional(),
  date: z.string().regex(dateRegex, V.dateInvalid),
  startTime: z.string().regex(timeRegex, 'Horário de início inválido (HH:MM)'),
  endTime: z.string().regex(timeRegex, 'Horário de fim inválido (HH:MM)'),
  description: z.string().max(500, V.max('Descrição', 500)).optional(),
  ticketId: z.string().uuid(V.uuidInvalid('Ticket')).nullable().optional(),
});

const submitWeekSchema = z.object({
  weekStartDate: z.string().regex(dateRegex, V.dateInvalid),
});

const approveEntriesSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1, 'Selecione pelo menos um apontamento.'),
});

const rejectEntrySchema = z.object({
  comment: z.string().min(1, V.required('Comentário')).max(500, V.max('Comentário', 500)),
});

const idSchema = z.string().uuid();

const getMonthEntries: RequestHandler = async (req, res, next) => {
  try {
    const date = z.string().regex(monthRegex, 'Formato invalido. Use YYYY-MM').parse(req.query.date);
    const result = await timeEntryService.getMonthEntries(req.userId!, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getWeekEntries: RequestHandler = async (req, res, next) => {
  try {
    const date = z.string().regex(dateRegex, V.dateInvalid).parse(req.query.date);
    const result = await timeEntryService.getWeekEntries(req.userId!, date);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const upsert: RequestHandler = async (req, res, next) => {
  try {
    const data = upsertEntrySchema.parse(req.body);
    const result = await timeEntryService.upsertTimeEntry({
      userId: req.userId!,
      id: data.id,
      projectId: data.projectId,
      categoryId: data.categoryId,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      description: data.description,
      ticketId: data.ticketId,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    await timeEntryService.deleteTimeEntry(idSchema.parse(req.params.id), req.userId!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const submitWeek: RequestHandler = async (req, res, next) => {
  try {
    const { weekStartDate } = submitWeekSchema.parse(req.body);
    const result = await timeEntryService.submitWeek(req.userId!, weekStartDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const submitEntrySchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const submitEntry: RequestHandler = async (req, res, next) => {
  try {
    const { params: { id } } = submitEntrySchema.parse({ params: req.params });
    const result = await timeEntryService.submitEntry(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const resubmit: RequestHandler = async (req, res, next) => {
  try {
    const result = await timeEntryService.resubmitEntry(idSchema.parse(req.params.id), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const listPending: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const consultantId = req.query.consultantId as string | undefined;
    const result = await timeEntryService.listPendingApprovals({ page, limit, consultantId });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const approve: RequestHandler = async (req, res, next) => {
  try {
    const { entryIds } = approveEntriesSchema.parse(req.body);
    const result = await timeEntryService.approveEntries(entryIds, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const reject: RequestHandler = async (req, res, next) => {
  try {
    const { comment } = rejectEntrySchema.parse(req.body);
    await timeEntryService.rejectEntry(idSchema.parse(req.params.id), req.userId!, comment);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await timeEntryService.listTimeEntries({
      page,
      limit,
      userId: req.query.userId as string | undefined,
      projectId: req.query.projectId as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      status: req.query.status as string | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const timeEntryController = {
  getMonthEntries,
  getWeekEntries,
  upsert,
  remove,
  submitWeek,
  submitEntry,
  resubmit,
  listPending,
  approve,
  reject,
  list,
};
