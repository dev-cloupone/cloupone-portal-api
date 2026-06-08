import { eq, and, ne, sql, count as drizzleCount, desc, between } from 'drizzle-orm';
import { db } from '../db';
import {
  expenseInvoices,
  expenseInvoiceItems,
  expenses,
  projectExpensePeriods,
  projects,
  clients,
} from '../db/schema';
import { AppError } from '../utils/app-error';
import { getNextInvoiceNumber } from '../utils/invoice-utils';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const MSG = {
  NOT_FOUND: 'Fatura de despesas não encontrada.',
  INVOICE_EXISTS: 'Já existe uma fatura ativa para este projeto/período.',
  NOT_DRAFT: 'Apenas faturas em rascunho podem ser editadas.',
  NOT_DRAFT_ISSUE: 'Apenas faturas em rascunho podem ser emitidas.',
  NOT_ISSUED: 'Apenas faturas emitidas podem ser marcadas como pagas.',
  ALREADY_CANCELLED: 'Esta fatura já está cancelada.',
  NOT_DRAFT_DELETE: 'Apenas faturas em rascunho podem ser excluídas.',
  ACCESS_DENIED: 'Você não tem acesso a esta fatura.',
  NO_EXPENSES: 'Nenhuma despesa aprovada encontrada para este período.',
  PERIOD_NOT_FOUND: 'Período não encontrado.',
} as const;

export async function generateDraft(projectId: string, periodId: string, createdBy: string) {
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

    // Get period
    const [period] = await tx.select()
      .from(projectExpensePeriods)
      .where(eq(projectExpensePeriods.id, periodId))
      .limit(1);

    if (!period) throw new AppError(MSG.PERIOD_NOT_FOUND, 404);

    // Check no active invoice exists for project/period
    const [existing] = await tx.select({ id: expenseInvoices.id })
      .from(expenseInvoices)
      .where(and(
        eq(expenseInvoices.projectId, projectId),
        eq(expenseInvoices.periodId, periodId),
        ne(expenseInvoices.status, 'cancelled'),
      )).limit(1);

    if (existing) throw new AppError(MSG.INVOICE_EXISTS, 409);

    // Get approved expenses for this period
    const approvedExpenses = await tx.select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      approvedAmount: expenses.approvedAmount,
    })
      .from(expenses)
      .where(and(
        eq(expenses.projectId, projectId),
        eq(expenses.status, 'approved'),
        between(expenses.date, period.weekStart, period.weekEnd),
      ));

    if (approvedExpenses.length === 0) throw new AppError(MSG.NO_EXPENSES, 400);

    // Create expense invoice
    const [invoice] = await tx.insert(expenseInvoices).values({
      clientId: project.clientId,
      projectId,
      periodId,
      periodStart: period.weekStart,
      periodEnd: period.weekEnd,
      status: 'draft',
      clientName: project.clientName,
      clientCnpj: project.clientCnpj,
      createdBy,
    }).returning();

    // Create items
    let totalAmount = 0;
    const createdItems = [];

    for (const expense of approvedExpenses) {
      const amount = expense.approvedAmount ?? expense.amount;
      totalAmount += Number(amount);

      const [item] = await tx.insert(expenseInvoiceItems).values({
        expenseInvoiceId: invoice.id,
        expenseId: expense.id,
        description: expense.description,
        originalAmount: amount,
        appliedAmount: amount,
      }).returning();

      createdItems.push(item);
    }

    // Update total
    const [updated] = await tx.update(expenseInvoices).set({
      totalAmount: totalAmount.toFixed(2),
    }).where(eq(expenseInvoices.id, invoice.id)).returning();

    return { ...updated, items: createdItems };
  });
}

export async function updateItems(
  invoiceId: string,
  items: { id: string; appliedAmount: string; description?: string }[],
  notes?: string,
) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    let totalAmount = 0;

    for (const item of items) {
      totalAmount += Number(item.appliedAmount);
      const updateData: Record<string, unknown> = {
        appliedAmount: item.appliedAmount,
      };
      if (item.description !== undefined) {
        updateData.description = item.description;
      }
      await tx.update(expenseInvoiceItems).set(updateData)
        .where(eq(expenseInvoiceItems.id, item.id));
    }

    const updateData: Record<string, unknown> = {
      totalAmount: totalAmount.toFixed(2),
      updatedAt: new Date(),
    };
    if (notes !== undefined) updateData.notes = notes;

    const [updated] = await tx.update(expenseInvoices)
      .set(updateData)
      .where(eq(expenseInvoices.id, invoiceId))
      .returning();

    return updated;
  });
}

export async function issue(invoiceId: string, issuedBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_ISSUE, 400);

    const invoiceNumber = await getNextInvoiceNumber(tx);

    const [updated] = await tx.update(expenseInvoices).set({
      status: 'issued',
      invoiceNumber,
      issuedAt: new Date(),
      issuedBy,
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function pay(invoiceId: string, paidBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'issued') throw new AppError(MSG.NOT_ISSUED, 400);

    const [updated] = await tx.update(expenseInvoices).set({
      status: 'paid',
      paidAt: new Date(),
      paidBy,
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function cancel(invoiceId: string, cancelledBy: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status === 'cancelled') throw new AppError(MSG.ALREADY_CANCELLED, 400);

    const [updated] = await tx.update(expenseInvoices).set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy,
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, invoiceId)).returning();

    return updated;
  });
}

export async function remove(invoiceId: string) {
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_DELETE, 400);

    await tx.delete(expenseInvoices).where(eq(expenseInvoices.id, invoiceId));
  });
}

export async function list(params: PaginationParams & { clientId?: string; projectId?: string; status?: string; year?: number; month?: number }) {
  const { page, limit, clientId, projectId, status, year, month } = params;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (clientId) conditions.push(eq(expenseInvoices.clientId, clientId));
  if (projectId) conditions.push(eq(expenseInvoices.projectId, projectId));
  if (status) conditions.push(eq(expenseInvoices.status, status as 'draft' | 'issued' | 'paid' | 'cancelled'));
  if (year) conditions.push(sql`EXTRACT(YEAR FROM ${expenseInvoices.periodStart})::integer = ${year}` as ReturnType<typeof eq>);
  if (month) conditions.push(sql`EXTRACT(MONTH FROM ${expenseInvoices.periodStart})::integer = ${month}` as ReturnType<typeof eq>);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: expenseInvoices.id,
      invoiceNumber: expenseInvoices.invoiceNumber,
      clientId: expenseInvoices.clientId,
      clientName: expenseInvoices.clientName,
      clientCnpj: expenseInvoices.clientCnpj,
      projectId: expenseInvoices.projectId,
      projectName: projects.name,
      periodId: expenseInvoices.periodId,
      periodStart: expenseInvoices.periodStart,
      periodEnd: expenseInvoices.periodEnd,
      status: expenseInvoices.status,
      totalAmount: expenseInvoices.totalAmount,
      issuedAt: expenseInvoices.issuedAt,
      paidAt: expenseInvoices.paidAt,
      cancelledAt: expenseInvoices.cancelledAt,
      notes: expenseInvoices.notes,
      createdAt: expenseInvoices.createdAt,
    })
      .from(expenseInvoices)
      .innerJoin(projects, eq(expenseInvoices.projectId, projects.id))
      .where(where)
      .orderBy(desc(expenseInvoices.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenseInvoices).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function listByClient(clientId: string, params: PaginationParams) {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const where = and(
    eq(expenseInvoices.clientId, clientId),
    sql`${expenseInvoices.status} IN ('issued', 'paid')`,
  );

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: expenseInvoices.id,
      invoiceNumber: expenseInvoices.invoiceNumber,
      clientId: expenseInvoices.clientId,
      clientName: expenseInvoices.clientName,
      clientCnpj: expenseInvoices.clientCnpj,
      projectId: expenseInvoices.projectId,
      projectName: projects.name,
      periodId: expenseInvoices.periodId,
      periodStart: expenseInvoices.periodStart,
      periodEnd: expenseInvoices.periodEnd,
      status: expenseInvoices.status,
      totalAmount: expenseInvoices.totalAmount,
      issuedAt: expenseInvoices.issuedAt,
      paidAt: expenseInvoices.paidAt,
      cancelledAt: expenseInvoices.cancelledAt,
      notes: expenseInvoices.notes,
      createdAt: expenseInvoices.createdAt,
    })
      .from(expenseInvoices)
      .innerJoin(projects, eq(expenseInvoices.projectId, projects.id))
      .where(where)
      .orderBy(desc(expenseInvoices.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expenseInvoices).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getById(invoiceId: string, requestUserId: string, requestUserRole: string, requestUserClientId?: string | null) {
  const [invoice] = await db.select({
    id: expenseInvoices.id,
    invoiceNumber: expenseInvoices.invoiceNumber,
    clientId: expenseInvoices.clientId,
    clientName: expenseInvoices.clientName,
    clientCnpj: expenseInvoices.clientCnpj,
    projectId: expenseInvoices.projectId,
    projectName: projects.name,
    periodId: expenseInvoices.periodId,
    periodStart: expenseInvoices.periodStart,
    periodEnd: expenseInvoices.periodEnd,
    status: expenseInvoices.status,
    totalAmount: expenseInvoices.totalAmount,
    issuedAt: expenseInvoices.issuedAt,
    paidAt: expenseInvoices.paidAt,
    cancelledAt: expenseInvoices.cancelledAt,
    notes: expenseInvoices.notes,
    createdAt: expenseInvoices.createdAt,
  })
    .from(expenseInvoices)
    .innerJoin(projects, eq(expenseInvoices.projectId, projects.id))
    .where(eq(expenseInvoices.id, invoiceId))
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

  const items = await db.select()
    .from(expenseInvoiceItems)
    .where(eq(expenseInvoiceItems.expenseInvoiceId, invoiceId));

  return { ...invoice, items };
}
