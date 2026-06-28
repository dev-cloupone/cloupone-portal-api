import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as monthlyTimesheetService from '../services/monthly-timesheet.service';
import { paginationSchema } from '../utils/pagination';
import { appError } from '../utils/app-error';
import { V } from '../utils/validation-messages';

const MSG = {
  CANNOT_VIEW_OTHER: { message: 'Você não tem permissão para ver apontamentos de outro consultor.', code: 'TIMESHEET_VIEW_FORBIDDEN' },
  CANNOT_APPROVE_OTHER: { message: 'Você não tem permissão para aprovar apontamentos de outro consultor.', code: 'TIMESHEET_APPROVE_FORBIDDEN' },
  APPROVE_PAST_ONLY: { message: 'Você só pode aprovar meses que já foram encerrados.', code: 'TIMESHEET_APPROVE_PAST_ONLY' },
} as const;

const yearMonthParamsSchema = z.object({
  userId: z.string().uuid(V.uuidInvalid('Usuário')),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const reopenSchema = z.object({
  reason: z.string().min(1, V.required('Motivo')).max(500, V.max('Motivo', 500)),
});

const listFiltersSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['open', 'approved', 'reopened', 'not_approved']).optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const filters = listFiltersSchema.parse(req.query);
    const result = await monthlyTimesheetService.list({ ...filters, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getDetail: RequestHandler = async (req, res, next) => {
  try {
    const { userId, year, month } = yearMonthParamsSchema.parse(req.params);

    // Consultor can only see their own
    if (req.userRole === 'consultor' && req.userId !== userId) {
      throw appError(MSG.CANNOT_VIEW_OTHER, 403);
    }

    const result = await monthlyTimesheetService.getDetail(userId, year, month);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getPending: RequestHandler = async (req, res, next) => {
  try {
    const result = await monthlyTimesheetService.getPending(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const approve: RequestHandler = async (req, res, next) => {
  try {
    const { userId, year, month } = yearMonthParamsSchema.parse(req.params);

    // Only super_admin can approve others' timesheets
    if (req.userRole !== 'super_admin' && req.userId !== userId) {
      throw appError(MSG.CANNOT_APPROVE_OTHER, 403);
    }

    // Non-admins can only approve past months — only admins can approve early
    if (req.userRole !== 'super_admin') {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      if (year > currentYear || (year === currentYear && month >= currentMonth)) {
        throw appError(MSG.APPROVE_PAST_ONLY, 400);
      }
    }

    const result = await monthlyTimesheetService.approve(userId, year, month, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const reopenMonth: RequestHandler = async (req, res, next) => {
  try {
    const { userId, year, month } = yearMonthParamsSchema.parse(req.params);
    const { reason } = reopenSchema.parse(req.body);
    const result = await monthlyTimesheetService.reopen(userId, year, month, req.userId!, reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const escalate: RequestHandler = async (_req, res, next) => {
  try {
    const result = await monthlyTimesheetService.runEscalation();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const monthlyTimesheetController = {
  list,
  getDetail,
  getPending,
  approve,
  reopen: reopenMonth,
  escalate,
};
