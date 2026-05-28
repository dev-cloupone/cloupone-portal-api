import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as paymentService from '../services/consultant-payment.service';
import { paginationSchema } from '../utils/pagination';

const idSchema = z.string().uuid();

const generatePaymentSchema = z.object({
  userId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const updateLinesSchema = z.object({
  lines: z.array(z.object({
    id: z.string().uuid(),
    appliedHours: z.string().regex(/^\d+(\.\d{1,2})?$/),
    appliedRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
  })),
  notes: z.string().max(2000).optional(),
});

const paySchema = z.object({
  notes: z.string().max(2000).optional(),
  receiptFileId: z.string().uuid().optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const userId = req.query.userId as string | undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const status = req.query.status as string | undefined;
    const result = await paymentService.list({ page, limit, userId, year, month, status });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const listMy: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await paymentService.listMy(req.userId!, { page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const generate: RequestHandler = async (req, res, next) => {
  try {
    const { userId, year, month } = generatePaymentSchema.parse(req.body);
    const result = await paymentService.generateDraft(userId, year, month, req.userId!);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await paymentService.getById(id, req.userId!, req.userRole!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { lines, notes } = updateLinesSchema.parse(req.body);
    const result = await paymentService.updateLines(id, lines, notes);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const confirmPayment: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await paymentService.confirm(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const payPayment: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { receiptFileId } = paySchema.parse(req.body);
    const result = await paymentService.pay(id, req.userId!, receiptFileId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const cancelPayment: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await paymentService.cancel(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const revertPayment: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await paymentService.revert(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const deletePayment: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    await paymentService.remove(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const getReceipt: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const url = await paymentService.getReceipt(id, req.userId!, req.userRole!);
    res.json({ url });
  } catch (err) {
    next(err);
  }
};

export const consultantPaymentController = {
  list,
  listMy,
  generate,
  getById,
  update,
  confirmPayment,
  payPayment,
  cancelPayment,
  revertPayment,
  deletePayment,
  getReceipt,
};
