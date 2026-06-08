import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as invoiceService from '../services/expense-invoice.service';
import { generateInvoiceExpensesPdf } from '../services/invoice-pdf.service';
import { paginationSchema } from '../utils/pagination';
import { AppError } from '../utils/app-error';

const idSchema = z.string().uuid();

const generateSchema = z.object({
  projectId: z.string().uuid(),
  periodId: z.string().uuid(),
});

const updateItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    appliedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    description: z.string().max(500).optional(),
  })),
  notes: z.string().max(2000).optional(),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const clientId = req.query.clientId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const status = req.query.status as string | undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const result = await invoiceService.list({ page, limit, clientId, projectId, status, year, month });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const listMy: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await invoiceService.listByClient(req.userClientId!, { page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const generate: RequestHandler = async (req, res, next) => {
  try {
    const { projectId, periodId } = generateSchema.parse(req.body);
    const result = await invoiceService.generateDraft(projectId, periodId, req.userId!);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const getById: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.getById(id, req.userId!, req.userRole!, req.userClientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const update: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { items, notes } = updateItemsSchema.parse(req.body);
    const result = await invoiceService.updateItems(id, items, notes);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const issueInvoice: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.issue(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const payInvoice: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.pay(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const cancelInvoice: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.cancel(id, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const deleteInvoice: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    await invoiceService.remove(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const getPdf: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const invoice = await invoiceService.getById(id, req.userId!, req.userRole!, req.userClientId);
    if (!invoice.invoiceNumber) {
      throw new AppError('Fatura ainda não foi emitida. Gere o PDF após emitir.', 400);
    }
    const buffer = await generateInvoiceExpensesPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=fatura-${invoice.invoiceNumber}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const removeItem: RequestHandler = async (req, res, next) => {
  try {
    const invoiceId = idSchema.parse(req.params.id);
    const itemId = idSchema.parse(req.params.itemId);
    const result = await invoiceService.removeItem(invoiceId, itemId);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const expenseInvoiceController = {
  list,
  listMy,
  generate,
  getById,
  update,
  issue: issueInvoice,
  pay: payInvoice,
  cancel: cancelInvoice,
  deleteInvoice,
  getPdf,
  removeItem,
};
