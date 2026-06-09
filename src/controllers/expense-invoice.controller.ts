import type { RequestHandler } from 'express';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import * as invoiceService from '../services/expense-invoice.service';
import { generateInvoiceExpensesPdf } from '../services/invoice-pdf.service';
import { paginationSchema } from '../utils/pagination';
import { AppError } from '../utils/app-error';
import { getS3Client, isR2Configured } from '../config/s3';
import { env } from '../config/env';
import { logger } from '../utils/logger';

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

const sanitizeFilename = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-{2,}/g, '-');
const formatDateBr = (d: string) => d.split('-').reverse().join('-');

const getReceiptsZip: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { invoice, files: receiptFiles } = await invoiceService.getReceiptFiles(id);

    if (!isR2Configured()) {
      throw new AppError('Storage não configurado.', 500);
    }

    const zipName = `${sanitizeFilename(invoice.projectName)}_${formatDateBr(invoice.periodStart)}-a-${formatDateBr(invoice.periodEnd)}_comprovantes.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = new ZipArchive();
    archive.pipe(res);

    archive.on('error', (err: Error) => {
      logger.error({ err, invoiceId: id }, 'Error creating receipts ZIP');
      if (!res.headersSent) {
        next(new AppError('Erro ao gerar arquivo ZIP.', 500));
      }
    });

    const s3 = getS3Client()!;
    const usedNames = new Set<string>();
    let addedCount = 0;

    for (const file of receiptFiles) {
      const ext = file.originalName?.includes('.')
        ? '.' + file.originalName.split('.').pop()
        : '';
      const baseName = sanitizeFilename(file.itemDescription || 'comprovante');
      let fileName = baseName + ext;

      let counter = 1;
      while (usedNames.has(fileName)) {
        fileName = `${baseName}_${counter}${ext}`;
        counter++;
      }
      usedNames.add(fileName);

      try {
        const command = new GetObjectCommand({
          Bucket: env.R2_BUCKET_NAME!,
          Key: file.storageKey,
        });
        const response = await s3.send(command);
        if (response.Body) {
          const stream = response.Body.transformToWebStream();
          archive.append(Readable.fromWeb(stream as any), { name: fileName });
          addedCount++;
        }
      } catch (err) {
        logger.warn({ err, fileId: file.fileId, storageKey: file.storageKey }, 'Failed to fetch receipt file from R2, skipping');
      }
    }

    if (addedCount === 0) {
      archive.abort();
      throw new AppError('Não foi possível recuperar nenhum comprovante do storage.', 500);
    }

    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) {
      next(err);
    }
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
  revertToDraft,
  revertToIssued,
  getReceiptsZip,
};
