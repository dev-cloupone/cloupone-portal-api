import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as expenseService from '../services/expense.service';
import { paginationSchema } from '../utils/pagination';
import { V } from '../utils/validation-messages';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const upsertExpenseSchema = z.object({
  id: z.string().uuid(V.uuidInvalid('Despesa')).optional(),
  projectId: z.string().uuid(V.uuidInvalid('Projeto')),
  consultantUserId: z.string().uuid(V.uuidInvalid('Consultor')).nullable().optional(),
  expenseCategoryId: z.string().uuid(V.uuidInvalid('Categoria')).nullable().optional(),
  date: z.string().regex(dateRegex, V.dateInvalid),
  description: z.string().max(500, V.max('Descrição', 500)).optional().nullable(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido'),
  kmQuantity: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  clientChargeAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  clientChargeAmountManuallySet: z.boolean().optional(),
  receiptFileId: z.string().uuid(V.uuidInvalid('Comprovante')).nullable().optional(),
  requiresReimbursement: z.boolean().optional(),
  templateId: z.string().uuid(V.uuidInvalid('Template')).nullable().optional(),
});


const approveExpensesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma despesa.'),
  updates: z.record(
    z.string().uuid(),
    z.object({
      clientChargeAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Valor inválido'),
    })
  ).optional(),
});

const rejectExpenseSchema = z.object({
  comment: z.string().min(1, V.required('Motivo')).max(500, V.max('Motivo', 500)),
});

const markReimbursedSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma despesa.'),
});

const idSchema = z.string().uuid();

const getMonthExpenses: RequestHandler = async (req, res, next) => {
  try {
    const year = z.coerce.number().int().parse(req.query.year);
    const month = z.coerce.number().int().min(1).max(12).parse(req.query.month);
    const consultantUserId = req.query.consultantUserId
      ? z.string().uuid().parse(req.query.consultantUserId)
      : undefined;
    const projectId = req.query.projectId
      ? z.string().uuid().parse(req.query.projectId)
      : undefined;
    const result = await expenseService.getMonthExpenses(
      req.userId!, req.userRole!, year, month, consultantUserId, projectId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getWeekExpenses: RequestHandler = async (req, res, next) => {
  try {
    const weekStartDate = z.string().regex(dateRegex, V.dateInvalid).parse(req.query.weekStartDate);
    const result = await expenseService.getWeekExpenses(req.userId!, weekStartDate);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const upsert: RequestHandler = async (req, res, next) => {
  try {
    const data = upsertExpenseSchema.parse(req.body);
    const result = await expenseService.upsertExpense(data, req.userId!, req.userRole!);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
};

const remove: RequestHandler = async (req, res, next) => {
  try {
    await expenseService.deleteExpense(idSchema.parse(req.params.id), req.userId!, req.userRole!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const resubmit: RequestHandler = async (req, res, next) => {
  try {
    const result = await expenseService.resubmitExpense(idSchema.parse(req.params.id), req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// Phase 4: Approval

const listPending: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const consultantId = req.query.consultantId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const result = await expenseService.listPendingApprovals({ page, limit, consultantId, projectId, requestUserId: req.userId!, requestUserRole: req.userRole! });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const approve: RequestHandler = async (req, res, next) => {
  try {
    const { ids, updates } = approveExpensesSchema.parse(req.body);
    const result = await expenseService.approveExpenses(ids, req.userId!, updates);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const reject: RequestHandler = async (req, res, next) => {
  try {
    const { comment } = rejectExpenseSchema.parse(req.body);
    await expenseService.rejectExpense(idSchema.parse(req.params.id), req.userId!, comment);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const revert: RequestHandler = async (req, res, next) => {
  try {
    const result = await expenseService.revertExpense(
      idSchema.parse(req.params.id), req.userId!, req.userRole!,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// Phase 5: Reimbursement

const listReimbursements: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await expenseService.listReimbursements({
      page,
      limit,
      consultantId: req.query.consultantId as string | undefined,
      projectId: req.query.projectId as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      reimbursementStatus: req.query.reimbursementStatus as 'pending' | 'paid' | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const markAsReimbursed: RequestHandler = async (req, res, next) => {
  try {
    const { ids } = markReimbursedSchema.parse(req.body);
    const result = await expenseService.markAsReimbursed(ids, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const unmarkReimbursement: RequestHandler = async (req, res, next) => {
  try {
    const result = await expenseService.unmarkReimbursement(idSchema.parse(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const expenseController = {
  getMonthExpenses,
  getWeekExpenses,
  upsert,
  remove,
  resubmit,
  revert,
  listPending,
  approve,
  reject,
  listReimbursements,
  markAsReimbursed,
  unmarkReimbursement,
};
