import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as invoiceService from '../services/invoice.service';
import * as installmentService from '../services/installment.service';
import { generateInvoiceHoursPdf } from '../services/invoice-pdf.service';
import { paginationSchema } from '../utils/pagination';
import { AppError } from '../utils/app-error';
import { V } from '../utils/validation-messages';

const idSchema = z.string().uuid();

const generateSchema = z.object({
  projectId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

const updateLinesSchema = z.object({
  lines: z.array(z.object({
    id: z.string().uuid(),
    appliedHours: z.string().regex(/^\d+(\.\d{1,2})?$/),
    appliedRate: z.string().regex(/^\d+(\.\d{1,2})?$/),
    description: z.string().max(500).optional(),
  })),
  notes: z.string().max(2000).optional(),
});

const addCustomLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.string().regex(/^\d+(\.\d{1,2})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const clientId = req.query.clientId as string | undefined;
    const projectId = req.query.projectId as string | undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const status = req.query.status as string | undefined;
    const invoiceType = req.query.invoiceType as string | undefined;
    const result = await invoiceService.list({ page, limit, clientId, projectId, year, month, status, invoiceType });
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
    const { projectId, year, month } = generateSchema.parse(req.body);
    const result = await invoiceService.generateDraft(projectId, year, month, req.userId!);
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
    const { lines, notes } = updateLinesSchema.parse(req.body);
    const result = await invoiceService.updateLines(id, lines, notes);
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
    const bankAccountId = z.string().uuid().parse(req.query.bankAccountId);
    const invoice = await invoiceService.getById(id, req.userId!, req.userRole!, req.userClientId);
    if (!invoice.invoiceNumber) {
      throw new AppError('Fatura ainda não foi emitida. Gere o PDF após emitir.', 400);
    }
    const buffer = await generateInvoiceHoursPdf(id, bankAccountId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=fatura-${invoice.invoiceNumber}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const addCustomLine: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const data = addCustomLineSchema.parse(req.body);
    const result = await invoiceService.addCustomLine(id, data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

const removeCustomLine: RequestHandler = async (req, res, next) => {
  try {
    const invoiceId = idSchema.parse(req.params.id);
    const lineId = idSchema.parse(req.params.lineId);
    await invoiceService.removeCustomLine(invoiceId, lineId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

const revertToDraft: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.revertToDraft(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const revertToIssued: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const result = await invoiceService.revertToIssued(id);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const pendingApprovals: RequestHandler = async (req, res, next) => {
  try {
    const { year, month } = z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }).parse(req.query);
    const result = await invoiceService.getPendingApprovals(year, month);
    res.json(result);
  } catch (err) { next(err); }
};

const generateFromInstallmentsSchema = z.object({
  projectId: z.string().uuid(V.uuidInvalid('Projeto')),
  installmentIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos uma parcela'),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

const generateFromInstallments: RequestHandler = async (req, res, next) => {
  try {
    const data = generateFromInstallmentsSchema.parse(req.body);
    const invoice = await invoiceService.generateFromInstallments(
      data.projectId, data.installmentIds, data.year, data.month, req.userId!
    );
    res.status(201).json(invoice);
  } catch (err) {
    next(err);
  }
};

const pendingInstallments: RequestHandler = async (_req, res, next) => {
  try {
    const result = await installmentService.getPendingInstallmentsWarning();
    res.json(result);
  } catch (err) { next(err); }
};

const pendingInstallmentsDetailed: RequestHandler = async (req, res, next) => {
  try {
    const { year, month } = z.object({
      year: z.coerce.number().int().min(2020).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }).parse(req.query);
    const result = await installmentService.getPendingInstallmentsDetailed(year, month);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const invoiceController = {
  list,
  listMy,
  generate,
  generateFromInstallments,
  getById,
  update,
  issue: issueInvoice,
  pay: payInvoice,
  cancel: cancelInvoice,
  deleteInvoice,
  getPdf,
  addCustomLine,
  removeCustomLine,
  pendingApprovals,
  pendingInstallments,
  pendingInstallmentsDetailed,
  revertToDraft,
  revertToIssued,
};
