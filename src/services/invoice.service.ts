import { eq, and, ne, sql, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  invoices,
  invoiceLines,
  projectAllocations,
  timeEntries,
  users,
  projects,
  clients,
  monthlyTimesheets,
} from '../db/schema';
import { AppError } from '../utils/app-error';
import { logger } from '../utils/logger';
import { getNextInvoiceNumber, type DbTransaction } from '../utils/invoice-utils';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const MSG = {
  NOT_FOUND: 'Fatura não encontrada.',
  INVOICE_EXISTS: 'Já existe uma fatura ativa para este projeto/mês.',
  NOT_DRAFT: 'Apenas faturas em rascunho podem ser editadas.',
  NOT_DRAFT_ISSUE: 'Apenas faturas em rascunho podem ser emitidas.',
  NOT_ISSUED: 'Apenas faturas emitidas podem ser marcadas como pagas.',
  ALREADY_CANCELLED: 'Esta fatura já está cancelada.',
  NOT_DRAFT_DELETE: 'Apenas faturas em rascunho podem ser excluídas.',
  ACCESS_DENIED: 'Você não tem acesso a esta fatura.',
  NO_ENTRIES: 'Nenhum lançamento de horas encontrado para este projeto/mês.',
  LINE_NOT_FOUND: 'Linha não encontrada.',
  LINE_NOT_IN_INVOICE: 'Linha não pertence a esta fatura.',
} as const;

async function recalculateInvoiceTotals(tx: DbTransaction, invoiceId: string) {
  const allLines = await tx.select({
    lineType: invoiceLines.lineType,
    appliedHours: invoiceLines.appliedHours,
    subtotal: invoiceLines.subtotal,
  }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));

  let totalHours = 0;
  let totalAmount = 0;
  for (const line of allLines) {
    if (line.lineType === 'hours') {
      totalHours += Number(line.appliedHours);
    }
    totalAmount += Number(line.subtotal);
  }

  await tx.update(invoices).set({
    totalHours: totalHours.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    updatedAt: new Date(),
  }).where(eq(invoices.id, invoiceId));
}

async function addOrUpdateConsultantLine(
  tx: DbTransaction,
  invoiceId: string,
  consultantId: string,
  projectId: string,
  year: number,
  month: number,
) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

  // Calculate consultant hours for project/month
  const [hoursResult] = await tx.select({
    totalHours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
  })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, consultantId),
      eq(timeEntries.projectId, projectId),
      sql`${timeEntries.date} >= ${firstDay}`,
      sql`${timeEntries.date} <= ${lastDay}`,
    ));

  const calculatedHours = hoursResult?.totalHours ?? '0';
  if (Number(calculatedHours) === 0) return;

  // Get billing rate
  const [allocation] = await tx.select({ billingRate: projectAllocations.billingRate })
    .from(projectAllocations)
    .where(and(
      eq(projectAllocations.userId, consultantId),
      eq(projectAllocations.projectId, projectId),
    )).limit(1);

  const billingRate = allocation?.billingRate ?? '0';

  // Get consultant name
  const [user] = await tx.select({ name: users.name })
    .from(users)
    .where(eq(users.id, consultantId))
    .limit(1);

  if (!user) {
    logger.warn({ consultantId, invoiceId }, 'Consultant not found when generating invoice line, using fallback name');
  }
  const consultantName = user?.name ?? 'Consultor';

  // Check existing line
  const [existingLine] = await tx.select()
    .from(invoiceLines)
    .where(and(
      eq(invoiceLines.invoiceId, invoiceId),
      eq(invoiceLines.lineType, 'hours'),
      eq(invoiceLines.consultantId, consultantId),
    )).limit(1);

  if (existingLine) {
    // Re-approval: update calculated values, preserve manual edits
    const oldCalculated = existingLine.calculatedHours;
    const oldOriginalRate = existingLine.originalRate;

    let newAppliedHours = existingLine.appliedHours;
    let newAppliedRate = existingLine.appliedRate;

    // If appliedHours was NOT manually edited (equals old calculated), update it
    if (existingLine.appliedHours === oldCalculated) {
      newAppliedHours = calculatedHours;
    }
    // If appliedRate was NOT manually edited (equals old original rate), update it
    if (existingLine.appliedRate === oldOriginalRate) {
      newAppliedRate = billingRate;
    }

    const subtotal = (Number(newAppliedHours) * Number(newAppliedRate)).toFixed(2);

    await tx.update(invoiceLines).set({
      calculatedHours,
      originalRate: billingRate,
      consultantName,
      appliedHours: newAppliedHours,
      appliedRate: newAppliedRate,
      subtotal,
    }).where(eq(invoiceLines.id, existingLine.id));
  } else {
    // New line
    const subtotal = (Number(calculatedHours) * Number(billingRate)).toFixed(2);

    await tx.insert(invoiceLines).values({
      invoiceId,
      lineType: 'hours',
      consultantId,
      consultantName,
      calculatedHours,
      appliedHours: calculatedHours,
      originalRate: billingRate,
      appliedRate: billingRate,
      subtotal,
    });
  }
}

export async function generateDraft(projectId: string, year: number, month: number, createdBy: string) {
  return await db.transaction(async (tx) => {
    // Get project with client
    const [project] = await tx.select({
      id: projects.id,
      clientId: projects.clientId,
      clientName: clients.companyName,
      clientCnpj: clients.cnpj,
    })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) throw new AppError('Projeto não encontrado.', 404);

    // Check no active invoice exists for project/month
    const [existing] = await tx.select({ id: invoices.id })
      .from(invoices)
      .where(and(
        eq(invoices.projectId, projectId),
        eq(invoices.year, year),
        eq(invoices.month, month),
        ne(invoices.status, 'cancelled'),
      )).limit(1);

    if (existing) throw new AppError(MSG.INVOICE_EXISTS, 409);

    // Get time entries grouped by consultant
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

    const entries = await tx.select({
      userId: timeEntries.userId,
      totalHours: sql<string>`SUM(${timeEntries.hours})`,
    })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.projectId, projectId),
        sql`${timeEntries.date} >= ${firstDay}`,
        sql`${timeEntries.date} <= ${lastDay}`,
      ))
      .groupBy(timeEntries.userId);

    if (entries.length === 0) throw new AppError(MSG.NO_ENTRIES, 400);

    // Create invoice
    const [invoice] = await tx.insert(invoices).values({
      clientId: project.clientId,
      projectId,
      year,
      month,
      status: 'draft',
      clientName: project.clientName,
      clientCnpj: project.clientCnpj,
      createdBy,
    }).returning();

    // Create lines for each consultant
    let totalHours = 0;
    let totalAmount = 0;
    const createdLines = [];

    for (const entry of entries) {
      // Get billing rate
      const [allocation] = await tx.select({ billingRate: projectAllocations.billingRate })
        .from(projectAllocations)
        .where(and(
          eq(projectAllocations.userId, entry.userId),
          eq(projectAllocations.projectId, projectId),
        )).limit(1);

      const billingRate = allocation?.billingRate ?? '0';

      // Get consultant name
      const [user] = await tx.select({ name: users.name })
        .from(users)
        .where(eq(users.id, entry.userId))
        .limit(1);

      const hours = Number(entry.totalHours);
      const rate = Number(billingRate);
      const subtotal = hours * rate;
      totalHours += hours;
      totalAmount += subtotal;

      const [line] = await tx.insert(invoiceLines).values({
        invoiceId: invoice.id,
        lineType: 'hours',
        consultantId: entry.userId,
        consultantName: user?.name ?? 'Consultor',
        calculatedHours: entry.totalHours,
        appliedHours: entry.totalHours,
        originalRate: billingRate,
        appliedRate: billingRate,
        subtotal: subtotal.toFixed(2),
      }).returning();

      createdLines.push(line);
    }

    // Update totals
    const [updated] = await tx.update(invoices).set({
      totalHours: totalHours.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
    }).where(eq(invoices.id, invoice.id)).returning();

    return { ...updated, lines: createdLines };
  });
}

export async function regenerateInvoiceDraftsForConsultant(userId: string, year: number, month: number, triggeredBy: string) {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

  // Find all projects where consultant has time entries this month
  const projectEntries = await db.selectDistinct({ projectId: timeEntries.projectId })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      sql`${timeEntries.date} >= ${firstDay}`,
      sql`${timeEntries.date} <= ${lastDay}`,
    ));

  for (const { projectId } of projectEntries) {
    try {
      await regenerateInvoiceDraftForProject(projectId, userId, year, month, triggeredBy);
    } catch (err) {
      logger.warn({ projectId, userId, year, month, err }, 'Invoice draft regen failed for project');
    }
  }
}

async function regenerateInvoiceDraftForProject(projectId: string, consultantId: string, year: number, month: number, triggeredBy: string) {
  await db.transaction(async (tx) => {
    // Find non-cancelled invoice for project+month
    const existingInvoices = await tx.select()
      .from(invoices)
      .where(and(
        eq(invoices.projectId, projectId),
        eq(invoices.year, year),
        eq(invoices.month, month),
        ne(invoices.status, 'cancelled'),
      ));

    let targetInvoiceId: string;

    if (existingInvoices.length === 0) {
      // No invoice → create new draft
      const [project] = await tx.select({
        clientId: projects.clientId,
        clientName: clients.companyName,
        clientCnpj: clients.cnpj,
      })
        .from(projects)
        .innerJoin(clients, eq(projects.clientId, clients.id))
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!project) return;

      const [newInvoice] = await tx.insert(invoices).values({
        clientId: project.clientId,
        projectId,
        year,
        month,
        status: 'draft',
        clientName: project.clientName,
        clientCnpj: project.clientCnpj,
        createdBy: triggeredBy,
      }).returning();

      targetInvoiceId = newInvoice.id;
    } else {
      // Find a draft among existing invoices
      const draftInvoice = existingInvoices.find(i => i.status === 'draft');
      if (draftInvoice) {
        targetInvoiceId = draftInvoice.id;
      } else {
        // All are issued/paid → skip, hours already invoiced
        logger.info({ projectId, consultantId, year, month }, 'Skipping invoice regen: active invoice already issued/paid');
        return;
      }
    }

    await addOrUpdateConsultantLine(tx, targetInvoiceId, consultantId, projectId, year, month);
    await recalculateInvoiceTotals(tx, targetInvoiceId);
  });
}

export async function addCustomLine(invoiceId: string, data: { description: string; quantity: string; unitPrice: string }) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    const subtotal = (Number(data.quantity) * Number(data.unitPrice)).toFixed(2);

    const [line] = await tx.insert(invoiceLines).values({
      invoiceId,
      lineType: 'custom',
      description: data.description,
      appliedHours: data.quantity,
      appliedRate: data.unitPrice,
      subtotal,
    }).returning();

    await recalculateInvoiceTotals(tx, invoiceId);

    return line;
  });
}

export async function removeCustomLine(invoiceId: string, lineId: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    const [line] = await tx.select()
      .from(invoiceLines)
      .where(eq(invoiceLines.id, lineId))
      .limit(1);

    if (!line) throw new AppError(MSG.LINE_NOT_FOUND, 404);
    if (line.invoiceId !== invoiceId) throw new AppError(MSG.LINE_NOT_IN_INVOICE, 400);

    await tx.delete(invoiceLines).where(eq(invoiceLines.id, lineId));
    await recalculateInvoiceTotals(tx, invoiceId);
  });
}

export async function updateLines(
  invoiceId: string,
  lines: { id: string; appliedHours: string; appliedRate: string; description?: string }[],
  notes?: string,
) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    for (const line of lines) {
      const subtotal = (Number(line.appliedHours) * Number(line.appliedRate)).toFixed(2);
      const updateData: Record<string, unknown> = {
        appliedHours: line.appliedHours,
        appliedRate: line.appliedRate,
        subtotal,
      };
      if (line.description !== undefined) {
        updateData.description = line.description;
      }
      await tx.update(invoiceLines).set(updateData)
        .where(eq(invoiceLines.id, line.id));
    }

    await recalculateInvoiceTotals(tx, invoiceId);

    const updateData: Record<string, unknown> = {};
    if (notes !== undefined) updateData.notes = notes;
    if (Object.keys(updateData).length > 0) {
      updateData.updatedAt = new Date();
      await tx.update(invoices).set(updateData).where(eq(invoices.id, invoiceId));
    }

    // Return updated invoice
    const [updated] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
    return updated;
  });
}

export async function issue(invoiceId: string, issuedBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_ISSUE, 400);

    const invoiceNumber = await getNextInvoiceNumber(tx);

    const [updated] = await tx.update(invoices).set({
      status: 'issued',
      invoiceNumber,
      issuedAt: new Date(),
      issuedBy,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function pay(invoiceId: string, paidBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'issued') throw new AppError(MSG.NOT_ISSUED, 400);

    const [updated] = await tx.update(invoices).set({
      status: 'paid',
      paidAt: new Date(),
      paidBy,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function cancel(invoiceId: string, cancelledBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status === 'cancelled') throw new AppError(MSG.ALREADY_CANCELLED, 400);

    const [updated] = await tx.update(invoices).set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function remove(invoiceId: string) {
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_DELETE, 400);

    await tx.delete(invoices).where(eq(invoices.id, invoiceId));
  });
}

export async function list(params: PaginationParams & { clientId?: string; projectId?: string; year?: number; month?: number; status?: string }) {
  const { page, limit, clientId, projectId, year, month, status } = params;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (clientId) conditions.push(eq(invoices.clientId, clientId));
  if (projectId) conditions.push(eq(invoices.projectId, projectId));
  if (year) conditions.push(eq(invoices.year, year));
  if (month) conditions.push(eq(invoices.month, month));
  if (status) conditions.push(eq(invoices.status, status as 'draft' | 'issued' | 'paid' | 'cancelled'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientId: invoices.clientId,
      clientName: invoices.clientName,
      clientCnpj: invoices.clientCnpj,
      projectId: invoices.projectId,
      projectName: projects.name,
      year: invoices.year,
      month: invoices.month,
      status: invoices.status,
      totalHours: invoices.totalHours,
      totalAmount: invoices.totalAmount,
      issuedAt: invoices.issuedAt,
      paidAt: invoices.paidAt,
      cancelledAt: invoices.cancelledAt,
      notes: invoices.notes,
      createdAt: invoices.createdAt,
    })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(invoices).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function listByClient(clientId: string, params: PaginationParams) {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const where = and(
    eq(invoices.clientId, clientId),
    sql`${invoices.status} IN ('issued', 'paid')`,
  );

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientId: invoices.clientId,
      clientName: invoices.clientName,
      clientCnpj: invoices.clientCnpj,
      projectId: invoices.projectId,
      projectName: projects.name,
      year: invoices.year,
      month: invoices.month,
      status: invoices.status,
      totalHours: invoices.totalHours,
      totalAmount: invoices.totalAmount,
      issuedAt: invoices.issuedAt,
      paidAt: invoices.paidAt,
      cancelledAt: invoices.cancelledAt,
      notes: invoices.notes,
      createdAt: invoices.createdAt,
    })
      .from(invoices)
      .innerJoin(projects, eq(invoices.projectId, projects.id))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(invoices).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getById(invoiceId: string, requestUserId: string, requestUserRole: string, requestUserClientId?: string | null) {
  const [invoice] = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    clientId: invoices.clientId,
    clientName: invoices.clientName,
    clientCnpj: invoices.clientCnpj,
    projectId: invoices.projectId,
    projectName: projects.name,
    year: invoices.year,
    month: invoices.month,
    status: invoices.status,
    totalHours: invoices.totalHours,
    totalAmount: invoices.totalAmount,
    issuedAt: invoices.issuedAt,
    paidAt: invoices.paidAt,
    cancelledAt: invoices.cancelledAt,
    notes: invoices.notes,
    createdAt: invoices.createdAt,
  })
    .from(invoices)
    .innerJoin(projects, eq(invoices.projectId, projects.id))
    .where(eq(invoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);

  // Access check
  if (requestUserRole === 'client') {
    if (invoice.clientId !== requestUserClientId) {
      throw new AppError(MSG.ACCESS_DENIED, 403);
    }
    if (invoice.status !== 'issued' && invoice.status !== 'paid') {
      throw new AppError(MSG.ACCESS_DENIED, 403);
    }
  } else if (requestUserRole !== 'super_admin' && requestUserRole !== 'administrative') {
    throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  const lines = await db.select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));

  return { ...invoice, lines };
}

export async function getPendingApprovals(year: number, month: number) {
  const results = await db.select({
    consultantName: users.name,
  })
    .from(monthlyTimesheets)
    .innerJoin(users, eq(monthlyTimesheets.userId, users.id))
    .where(and(
      eq(monthlyTimesheets.year, year),
      eq(monthlyTimesheets.month, month),
      sql`${monthlyTimesheets.status} IN ('open', 'reopened')`,
    ));

  return {
    count: results.length,
    consultants: results.map(r => r.consultantName),
  };
}
