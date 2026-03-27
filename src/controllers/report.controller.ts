import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as reportService from '../services/report.service';
import { V } from '../utils/validation-messages';

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, V.dateInvalid),
});

const idSchema = z.string().uuid();

const clientPdf: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const buffer = await reportService.generateClientPdf(clientId, from, to);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=relatorio-cliente-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const clientCsv: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const csv = await reportService.generateClientCsv(clientId, from, to);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-cliente-${from}-${to}.csv`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (err) {
    next(err);
  }
};

const billing: RequestHandler = async (req, res, next) => {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const buffer = await reportService.generateBillingPdf(from, to);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=faturamento-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const payroll: RequestHandler = async (req, res, next) => {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const buffer = await reportService.generatePayrollPdf(from, to);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=pagamento-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const clientData: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const data = await reportService.getClientReportData(clientId, from, to);
    res.json({
      client: data.client,
      entries: data.entries,
      totalHours: data.totalHours,
      totalValue: data.totalValue,
      projectSummary: data.projectSummary,
    });
  } catch (err) {
    next(err);
  }
};

// --- Consultant Report ---

const consultantData: RequestHandler = async (req, res, next) => {
  try {
    const consultantId = idSchema.parse(req.params.consultantId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const data = await reportService.getConsultantReportData(consultantId, from, to);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const consultantPdf: RequestHandler = async (req, res, next) => {
  try {
    const consultantId = idSchema.parse(req.params.consultantId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const buffer = await reportService.generateConsultantPdf(consultantId, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=relatorio-consultor-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const consultantCsv: RequestHandler = async (req, res, next) => {
  try {
    const consultantId = idSchema.parse(req.params.consultantId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const csv = await reportService.generateConsultantCsv(consultantId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-consultor-${from}-${to}.csv`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
};

// --- Enhanced Client Report ---

const enhancedClientData: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const data = await reportService.getEnhancedClientReportData(clientId, from, to);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const enhancedClientPdf: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const buffer = await reportService.generateEnhancedClientPdf(clientId, from, to);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=relatorio-cliente-detalhado-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const enhancedClientCsv: RequestHandler = async (req, res, next) => {
  try {
    const clientId = idSchema.parse(req.params.clientId);
    const { from, to } = dateRangeSchema.parse(req.query);
    const csv = await reportService.generateEnhancedClientCsv(clientId, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-cliente-detalhado-${from}-${to}.csv`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
};

// --- Expense Report ---

const expenseData: RequestHandler = async (req, res, next) => {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const filters = {
      projectId: req.query.projectId as string | undefined,
      consultantId: req.query.consultantId as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      reimbursementStatus: req.query.reimbursementStatus as 'pending' | 'paid' | 'all' | undefined,
    };
    const data = await reportService.getExpenseReportData(from, to, filters);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const expensePdf: RequestHandler = async (req, res, next) => {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const filters = {
      projectId: req.query.projectId as string | undefined,
      consultantId: req.query.consultantId as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      reimbursementStatus: req.query.reimbursementStatus as 'pending' | 'paid' | 'all' | undefined,
    };
    const buffer = await reportService.generateExpensePdf(from, to, filters);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=relatorio-despesas-${from}-${to}.pdf`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

const expenseCsv: RequestHandler = async (req, res, next) => {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const filters = {
      projectId: req.query.projectId as string | undefined,
      consultantId: req.query.consultantId as string | undefined,
      categoryId: req.query.categoryId as string | undefined,
      reimbursementStatus: req.query.reimbursementStatus as 'pending' | 'paid' | 'all' | undefined,
    };
    const csv = await reportService.generateExpenseCsv(from, to, filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=relatorio-despesas-${from}-${to}.csv`);
    res.send('\uFEFF' + csv);
  } catch (err) {
    next(err);
  }
};

export const reportController = {
  clientPdf, clientCsv, billing, payroll, clientData,
  consultantData, consultantPdf, consultantCsv,
  enhancedClientData, enhancedClientPdf, enhancedClientCsv,
  expenseData, expensePdf, expenseCsv,
};
