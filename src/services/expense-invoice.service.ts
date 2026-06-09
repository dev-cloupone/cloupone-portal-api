import { eq, and, ne, sql, count as drizzleCount, desc, between, lte, gte } from 'drizzle-orm';
import { db } from '../db';
import {
  expenseInvoices,
  expenseInvoiceItems,
  expenses,
  projectExpensePeriods,
  projectExpenseCategories,
  projects,
  clients,
  users,
  files,
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
  NOT_ISSUED_REVERT: 'Apenas faturas emitidas podem ser revertidas para rascunho.',
  NOT_PAID_REVERT: 'Apenas faturas pagas podem ser revertidas para emitida.',
  DRAFT_EXISTS_REVERT: 'Já existe um rascunho para este projeto/período. Exclua ou emita o rascunho existente antes de reverter.',
  ACCESS_DENIED: 'Você não tem acesso a esta fatura.',
  NO_EXPENSES: 'Nenhuma despesa aprovada encontrada para este período.',
  NO_RECEIPTS: 'Nenhum comprovante encontrado para os itens desta fatura.',
  PERIOD_NOT_FOUND: 'Período não encontrado.',
  ITEM_NOT_FOUND: 'Item não encontrado nesta fatura.',
  NOT_ISSUED_RECEIPTS: 'Fatura ainda não foi emitida.',
} as const;

function buildItemDescription(
  consultantName: string | null,
  categoryName: string | null,
  isKmCategory: boolean,
  kmQuantity: string | null,
): string {
  const parts: string[] = [];
  if (consultantName) parts.push(consultantName);
  if (categoryName) parts.push(categoryName);
  let desc = parts.join(' - ') || 'Despesa';
  if (isKmCategory && kmQuantity) {
    desc += ` (${kmQuantity} km)`;
  }
  return desc;
}

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

    // Get approved expenses for this period with consultant and category info
    const approvedExpenses = await tx.select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      approvedAmount: expenses.approvedAmount,
      kmQuantity: expenses.kmQuantity,
      consultantName: users.name,
      categoryName: projectExpenseCategories.name,
      isKmCategory: projectExpenseCategories.isKmCategory,
    })
      .from(expenses)
      .leftJoin(users, eq(expenses.consultantUserId, users.id))
      .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
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
        description: buildItemDescription(
          expense.consultantName,
          expense.categoryName,
          expense.isKmCategory ?? false,
          expense.kmQuantity,
        ),
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

// --- Auto-draft functions ---

export async function addExpenseToInvoiceDraft(expenseId: string, createdBy: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Fetch expense with consultant, category, project, client
    const [expense] = await tx.select({
      id: expenses.id,
      status: expenses.status,
      projectId: expenses.projectId,
      date: expenses.date,
      amount: expenses.amount,
      approvedAmount: expenses.approvedAmount,
      kmQuantity: expenses.kmQuantity,
      consultantName: users.name,
      categoryName: projectExpenseCategories.name,
      isKmCategory: projectExpenseCategories.isKmCategory,
      clientId: projects.clientId,
      clientName: clients.companyName,
      clientCnpj: clients.cnpj,
    })
      .from(expenses)
      .innerJoin(projects, eq(expenses.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(users, eq(expenses.consultantUserId, users.id))
      .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
      .where(eq(expenses.id, expenseId))
      .limit(1);

    if (!expense) return;
    if (expense.status !== 'approved') return;

    // Find matching period
    const [period] = await tx.select({
      id: projectExpensePeriods.id,
      weekStart: projectExpensePeriods.weekStart,
      weekEnd: projectExpensePeriods.weekEnd,
    })
      .from(projectExpensePeriods)
      .where(and(
        eq(projectExpensePeriods.projectId, expense.projectId),
        lte(projectExpensePeriods.weekStart, expense.date),
        gte(projectExpensePeriods.weekEnd, expense.date),
      ))
      .limit(1);

    if (!period) return; // No period for this date

    // Check if expense is already in a non-cancelled invoice
    const [existingItem] = await tx.select({ id: expenseInvoiceItems.id })
      .from(expenseInvoiceItems)
      .innerJoin(expenseInvoices, eq(expenseInvoiceItems.expenseInvoiceId, expenseInvoices.id))
      .where(and(
        eq(expenseInvoiceItems.expenseId, expenseId),
        ne(expenseInvoices.status, 'cancelled'),
      ))
      .limit(1);

    if (existingItem) return; // Already linked

    const itemAmount = expense.approvedAmount ?? expense.amount;
    const description = buildItemDescription(
      expense.consultantName,
      expense.categoryName,
      expense.isKmCategory ?? false,
      expense.kmQuantity,
    );

    // Look for existing draft
    const [existingDraft] = await tx.select()
      .from(expenseInvoices)
      .where(and(
        eq(expenseInvoices.projectId, expense.projectId),
        eq(expenseInvoices.periodId, period.id),
        eq(expenseInvoices.status, 'draft'),
      ))
      .limit(1);

    if (existingDraft) {
      // Add item to existing draft
      await tx.insert(expenseInvoiceItems).values({
        expenseInvoiceId: existingDraft.id,
        expenseId,
        description,
        originalAmount: itemAmount,
        appliedAmount: itemAmount,
      });

      const newTotal = (Number(existingDraft.totalAmount) + Number(itemAmount)).toFixed(2);
      await tx.update(expenseInvoices).set({
        totalAmount: newTotal,
        updatedAt: new Date(),
      }).where(eq(expenseInvoices.id, existingDraft.id));
    } else {
      // Create new draft
      try {
        const [invoice] = await tx.insert(expenseInvoices).values({
          clientId: expense.clientId,
          projectId: expense.projectId,
          periodId: period.id,
          periodStart: period.weekStart,
          periodEnd: period.weekEnd,
          status: 'draft',
          clientName: expense.clientName,
          clientCnpj: expense.clientCnpj,
          totalAmount: itemAmount,
          createdBy,
        }).returning();

        await tx.insert(expenseInvoiceItems).values({
          expenseInvoiceId: invoice.id,
          expenseId,
          description,
          originalAmount: itemAmount,
          appliedAmount: itemAmount,
        });
      } catch (err: any) {
        // Unique constraint violation — race condition
        if (err?.code === '23505') {
          const [raceDraft] = await tx.select()
            .from(expenseInvoices)
            .where(and(
              eq(expenseInvoices.projectId, expense.projectId),
              eq(expenseInvoices.periodId, period.id),
              eq(expenseInvoices.status, 'draft'),
            ))
            .limit(1);

          if (raceDraft) {
            await tx.insert(expenseInvoiceItems).values({
              expenseInvoiceId: raceDraft.id,
              expenseId,
              description,
              originalAmount: itemAmount,
              appliedAmount: itemAmount,
            });

            const newTotal = (Number(raceDraft.totalAmount) + Number(itemAmount)).toFixed(2);
            await tx.update(expenseInvoices).set({
              totalAmount: newTotal,
              updatedAt: new Date(),
            }).where(eq(expenseInvoices.id, raceDraft.id));
          }
          return;
        }
        throw err;
      }
    }
  });
}

export async function checkExpenseInvoiceLink(expenseId: string): Promise<{ linked: boolean; invoiceStatus?: string; invoiceId?: string }> {
  const [item] = await db.select({
    invoiceId: expenseInvoices.id,
    invoiceStatus: expenseInvoices.status,
  })
    .from(expenseInvoiceItems)
    .innerJoin(expenseInvoices, eq(expenseInvoiceItems.expenseInvoiceId, expenseInvoices.id))
    .where(and(
      eq(expenseInvoiceItems.expenseId, expenseId),
      ne(expenseInvoices.status, 'cancelled'),
    ))
    .limit(1);

  if (!item) return { linked: false };
  return { linked: true, invoiceStatus: item.invoiceStatus, invoiceId: item.invoiceId };
}

export async function removeExpenseFromInvoiceDraft(expenseId: string): Promise<{ removed: boolean; invoiceDeleted: boolean }> {
  return await db.transaction(async (tx) => {
    const [item] = await tx.select({
      itemId: expenseInvoiceItems.id,
      invoiceId: expenseInvoiceItems.expenseInvoiceId,
      invoiceStatus: expenseInvoices.status,
    })
      .from(expenseInvoiceItems)
      .innerJoin(expenseInvoices, eq(expenseInvoiceItems.expenseInvoiceId, expenseInvoices.id))
      .where(and(
        eq(expenseInvoiceItems.expenseId, expenseId),
        eq(expenseInvoices.status, 'draft'),
      ))
      .limit(1);

    if (!item) return { removed: false, invoiceDeleted: false };

    // Delete the item
    await tx.delete(expenseInvoiceItems).where(eq(expenseInvoiceItems.id, item.itemId));

    // Check if invoice has remaining items
    const [{ count }] = await tx.select({ count: drizzleCount() })
      .from(expenseInvoiceItems)
      .where(eq(expenseInvoiceItems.expenseInvoiceId, item.invoiceId));

    if (count === 0) {
      // Delete empty invoice
      await tx.delete(expenseInvoices).where(eq(expenseInvoices.id, item.invoiceId));
      return { removed: true, invoiceDeleted: true };
    }

    // Recalculate total
    const remainingItems = await tx.select({ appliedAmount: expenseInvoiceItems.appliedAmount })
      .from(expenseInvoiceItems)
      .where(eq(expenseInvoiceItems.expenseInvoiceId, item.invoiceId));

    const totalAmount = remainingItems.reduce((sum, i) => sum + Number(i.appliedAmount), 0);
    await tx.update(expenseInvoices).set({
      totalAmount: totalAmount.toFixed(2),
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, item.invoiceId));

    return { removed: true, invoiceDeleted: false };
  });
}

// --- Item management ---

export async function removeItem(invoiceId: string, itemId: string): Promise<{ removed: boolean; invoiceDeleted: boolean }> {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    const [item] = await tx.select({ id: expenseInvoiceItems.id })
      .from(expenseInvoiceItems)
      .where(and(
        eq(expenseInvoiceItems.id, itemId),
        eq(expenseInvoiceItems.expenseInvoiceId, invoiceId),
      ))
      .limit(1);

    if (!item) throw new AppError(MSG.ITEM_NOT_FOUND, 404);

    await tx.delete(expenseInvoiceItems).where(eq(expenseInvoiceItems.id, itemId));

    // Check if invoice has remaining items
    const [{ count }] = await tx.select({ count: drizzleCount() })
      .from(expenseInvoiceItems)
      .where(eq(expenseInvoiceItems.expenseInvoiceId, invoiceId));

    if (count === 0) {
      await tx.delete(expenseInvoices).where(eq(expenseInvoices.id, invoiceId));
      return { removed: true, invoiceDeleted: true };
    }

    // Recalculate total
    const remainingItems = await tx.select({ appliedAmount: expenseInvoiceItems.appliedAmount })
      .from(expenseInvoiceItems)
      .where(eq(expenseInvoiceItems.expenseInvoiceId, invoiceId));

    const totalAmount = remainingItems.reduce((sum, i) => sum + Number(i.appliedAmount), 0);
    await tx.update(expenseInvoices).set({
      totalAmount: totalAmount.toFixed(2),
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, invoiceId));

    return { removed: true, invoiceDeleted: false };
  });
}

// --- Revert status functions ---

export async function revertToDraft(invoiceId: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'issued') throw new AppError(MSG.NOT_ISSUED_REVERT, 400);

    // Check if a draft already exists for same project/period
    const [existingDraft] = await tx.select({ id: expenseInvoices.id })
      .from(expenseInvoices)
      .where(and(
        eq(expenseInvoices.projectId, invoice.projectId),
        eq(expenseInvoices.periodId, invoice.periodId),
        eq(expenseInvoices.status, 'draft'),
      ))
      .limit(1);

    if (existingDraft) throw new AppError(MSG.DRAFT_EXISTS_REVERT, 409);

    try {
      const [updated] = await tx.update(expenseInvoices).set({
        status: 'draft',
        invoiceNumber: null,
        issuedAt: null,
        issuedBy: null,
        updatedAt: new Date(),
      }).where(eq(expenseInvoices.id, invoiceId)).returning();

      return updated;
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new AppError(MSG.DRAFT_EXISTS_REVERT, 409);
      }
      throw err;
    }
  });
}

export async function revertToIssued(invoiceId: string) {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(expenseInvoices)
      .where(eq(expenseInvoices.id, invoiceId))
      .limit(1);

    if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
    if (invoice.status !== 'paid') throw new AppError(MSG.NOT_PAID_REVERT, 400);

    const [updated] = await tx.update(expenseInvoices).set({
      status: 'issued',
      paidAt: null,
      paidBy: null,
      updatedAt: new Date(),
    }).where(eq(expenseInvoices.id, invoiceId)).returning();

    return updated;
  });
}

// --- Receipt files for ZIP ---

export async function getReceiptFiles(invoiceId: string) {
  const [invoice] = await db.select({
    id: expenseInvoices.id,
    status: expenseInvoices.status,
    projectName: projects.name,
    periodStart: expenseInvoices.periodStart,
    periodEnd: expenseInvoices.periodEnd,
  })
    .from(expenseInvoices)
    .innerJoin(projects, eq(expenseInvoices.projectId, projects.id))
    .where(eq(expenseInvoices.id, invoiceId))
    .limit(1);

  if (!invoice) throw new AppError(MSG.NOT_FOUND, 404);
  if (invoice.status === 'draft') throw new AppError(MSG.NOT_ISSUED_RECEIPTS, 400);

  const itemsWithFiles = await db.select({
    itemDescription: expenseInvoiceItems.description,
    fileId: files.id,
    storageKey: files.storageKey,
    originalName: files.originalName,
    mimeType: files.mimeType,
  })
    .from(expenseInvoiceItems)
    .innerJoin(expenses, eq(expenseInvoiceItems.expenseId, expenses.id))
    .innerJoin(files, eq(expenses.receiptFileId, files.id))
    .where(eq(expenseInvoiceItems.expenseInvoiceId, invoiceId));

  if (itemsWithFiles.length === 0) {
    throw new AppError(MSG.NO_RECEIPTS, 404);
  }

  return { invoice, files: itemsWithFiles };
}
