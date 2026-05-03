import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as reportMgmtService from '../services/report-management.service';
import * as expenseReportService from '../services/expense-report.service';

const expenseReportSchema = z.object({
  projectId: z.string().uuid(),
  weekIds: z.union([z.string().uuid(), z.array(z.string().uuid())]).transform((v) =>
    Array.isArray(v) ? v : [v]
  ),
  consultantId: z.string().uuid().optional(),
  view: z.enum(['client', 'consultant']),
});

const list: RequestHandler = async (req, res, next) => {
  try {
    const data = await reportMgmtService.listReports(req.userId!, req.userRole!);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const getBySlug: RequestHandler = async (req, res, next) => {
  try {
    const slug = z.string().parse(req.params.slug);
    const data = await reportMgmtService.getReportBySlug(slug, req.userId!, req.userRole!);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const listPermissions: RequestHandler = async (req, res, next) => {
  try {
    const reportId = z.string().uuid().parse(req.params.reportId);
    const data = await reportMgmtService.listPermissions(reportId);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const updatePermissions: RequestHandler = async (req, res, next) => {
  try {
    const reportId = z.string().uuid().parse(req.params.reportId);
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()) }).parse(req.body);
    await reportMgmtService.updatePermissions(reportId, userIds, req.userId!);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const expenseData: RequestHandler = async (req, res, next) => {
  try {
    await reportMgmtService.getReportBySlug('expenses', req.userId!, req.userRole!);
    const filters = expenseReportSchema.parse(req.query);
    const data = await expenseReportService.getExpenseReportData(filters);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const expensePdf: RequestHandler = async (req, res, next) => {
  try {
    await reportMgmtService.getReportBySlug('expenses', req.userId!, req.userRole!);
    const filters = expenseReportSchema.parse(req.query);
    const buffer = await expenseReportService.generateExpenseReportPdf(filters);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=relatorio-despesas.pdf');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

export const reportManagementController = {
  list, getBySlug, listPermissions, updatePermissions,
  expenseData, expensePdf,
};
