import { eq, and, ne, inArray, sql, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  expensePayments,
  expensePaymentItems,
  expenses,
  projectExpensePeriods,
  projectAllocations,
  users,
  projects,
  projectExpenseCategories,
} from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import { getPresignedUrl } from './file.service';

const MSG = {
  NOT_FOUND: 'Pagamento não encontrado.',
  PAYMENT_EXISTS: 'Já existe um pagamento ativo para este consultor neste período.',
  NO_EXPENSES: 'Nenhuma despesa elegível encontrada para os períodos selecionados.',
  NOT_DRAFT: 'Apenas pagamentos em rascunho podem ser editados.',
  NOT_DRAFT_CONFIRM: 'Apenas pagamentos em rascunho podem ser confirmados.',
  NOT_CONFIRMED: 'Apenas pagamentos confirmados podem ser pagos.',
  ALREADY_CANCELLED: 'Este pagamento já está cancelado.',
  NOT_CONFIRMED_REVERT: 'Apenas pagamentos confirmados podem ser revertidos para rascunho.',
  NOT_DRAFT_DELETE: 'Apenas pagamentos em rascunho podem ser excluídos.',
  ACCESS_DENIED: 'Você não tem acesso a este pagamento.',
} as const;

export async function getAvailablePeriods(userId: string) {
  // Get all projects where the consultant is allocated
  const allocations = await db.select({ projectId: projectAllocations.projectId })
    .from(projectAllocations)
    .where(eq(projectAllocations.userId, userId));

  if (allocations.length === 0) return [];

  const projectIds = allocations.map(a => a.projectId);

  // Get all expense periods for these projects
  const periods = await db.select({
    periodId: projectExpensePeriods.id,
    projectId: projectExpensePeriods.projectId,
    projectName: projects.name,
    weekStart: projectExpensePeriods.weekStart,
    weekEnd: projectExpensePeriods.weekEnd,
  })
    .from(projectExpensePeriods)
    .innerJoin(projects, eq(projectExpensePeriods.projectId, projects.id))
    .where(inArray(projectExpensePeriods.projectId, projectIds));

  // For each period, count eligible expenses
  const result = [];
  for (const period of periods) {
    const [stats] = await db.select({
      expenseCount: drizzleCount(),
      totalAmount: sql<string>`COALESCE(SUM(COALESCE(${expenses.approvedAmount}, ${expenses.amount})), 0)`,
    })
      .from(expenses)
      .where(and(
        eq(expenses.consultantUserId, userId),
        eq(expenses.projectId, period.projectId),
        eq(expenses.status, 'approved'),
        eq(expenses.requiresReimbursement, true),
        sql`${expenses.reimbursedAt} IS NULL`,
        sql`${expenses.date} >= ${period.weekStart}`,
        sql`${expenses.date} <= ${period.weekEnd}`,
      ));

    if (stats.expenseCount > 0) {
      result.push({
        projectId: period.projectId,
        projectName: period.projectName,
        periodId: period.periodId,
        weekStart: period.weekStart,
        weekEnd: period.weekEnd,
        expenseCount: stats.expenseCount,
        totalAmount: stats.totalAmount,
      });
    }
  }

  return result;
}

export async function generateDraft(userId: string, periodIds: string[], createdBy: string) {
  return await db.transaction(async (tx) => {
    // Get the selected periods
    const selectedPeriods = await tx.select({
      id: projectExpensePeriods.id,
      projectId: projectExpensePeriods.projectId,
      weekStart: projectExpensePeriods.weekStart,
      weekEnd: projectExpensePeriods.weekEnd,
    })
      .from(projectExpensePeriods)
      .where(inArray(projectExpensePeriods.id, periodIds));

    if (selectedPeriods.length === 0) throw new AppError('Períodos não encontrados.', 400);

    // Get eligible expenses in a single query (joining with periods)
    const expenseRows = await tx.select({
      id: expenses.id,
      amount: expenses.amount,
      approvedAmount: expenses.approvedAmount,
    })
      .from(expenses)
      .innerJoin(projectExpensePeriods, and(
        eq(expenses.projectId, projectExpensePeriods.projectId),
        sql`${expenses.date} >= ${projectExpensePeriods.weekStart}`,
        sql`${expenses.date} <= ${projectExpensePeriods.weekEnd}`,
      ))
      .where(and(
        eq(expenses.consultantUserId, userId),
        inArray(projectExpensePeriods.id, periodIds),
        eq(expenses.status, 'approved'),
        eq(expenses.requiresReimbursement, true),
        sql`${expenses.reimbursedAt} IS NULL`,
      ));

    if (expenseRows.length === 0) throw new AppError(MSG.NO_EXPENSES, 400);

    // Calculate period range
    const weekStarts = selectedPeriods.map(p => p.weekStart);
    const weekEnds = selectedPeriods.map(p => p.weekEnd);
    const periodStart = weekStarts.sort()[0];
    const periodEnd = weekEnds.sort().reverse()[0];

    // Create payment
    let totalAmount = 0;
    const items = expenseRows.map(e => {
      const amount = e.approvedAmount ?? e.amount;
      totalAmount += Number(amount);
      return { expenseId: e.id, amount };
    });

    const [payment] = await tx.insert(expensePayments).values({
      userId,
      periodStart,
      periodEnd,
      status: 'draft',
      totalAmount: totalAmount.toFixed(2),
      createdBy,
    }).returning();

    const createdItems = await tx.insert(expensePaymentItems)
      .values(items.map(i => ({ ...i, expensePaymentId: payment.id })))
      .returning();

    return { ...payment, items: createdItems };
  });
}

export async function updatePayment(paymentId: string, notes?: string) {
  const [payment] = await db.select()
    .from(expensePayments)
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

  const [updated] = await db.update(expensePayments).set({
    notes: notes ?? payment.notes,
    updatedAt: new Date(),
  }).where(eq(expensePayments.id, paymentId)).returning();

  return updated;
}

export async function confirm(paymentId: string, confirmedBy: string) {
  const [payment] = await db.select()
    .from(expensePayments)
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_CONFIRM, 400);

  const now = new Date();
  const [updated] = await db.update(expensePayments).set({
    status: 'confirmed',
    confirmedAt: now,
    confirmedBy,
    updatedAt: now,
  }).where(eq(expensePayments.id, paymentId)).returning();

  return updated;
}

export async function pay(paymentId: string, paidBy: string, receiptFileId?: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(expensePayments)
      .where(eq(expensePayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status !== 'confirmed') throw new AppError(MSG.NOT_CONFIRMED, 400);

    const now = new Date();

    // Mark expenses as reimbursed
    const items = await tx.select({ expenseId: expensePaymentItems.expenseId })
      .from(expensePaymentItems)
      .where(eq(expensePaymentItems.expensePaymentId, paymentId));

    if (items.length > 0) {
      await tx.update(expenses).set({
        reimbursedAt: now,
        reimbursedBy: paidBy,
        updatedAt: now,
      }).where(inArray(expenses.id, items.map(i => i.expenseId)));
    }

    const updateData: Record<string, unknown> = {
      status: 'paid',
      paidAt: now,
      paidBy,
      updatedAt: now,
    };
    if (receiptFileId) updateData.receiptFileId = receiptFileId;

    const [updated] = await tx.update(expensePayments)
      .set(updateData)
      .where(eq(expensePayments.id, paymentId))
      .returning();

    return updated;
  });
}

export async function cancel(paymentId: string, cancelledBy: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(expensePayments)
      .where(eq(expensePayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status === 'cancelled') throw new AppError(MSG.ALREADY_CANCELLED, 400);

    const now = new Date();

    // If was paid, revert reimbursement
    if (payment.status === 'paid') {
      const items = await tx.select({ expenseId: expensePaymentItems.expenseId })
        .from(expensePaymentItems)
        .where(eq(expensePaymentItems.expensePaymentId, paymentId));

      if (items.length > 0) {
        await tx.update(expenses).set({
          reimbursedAt: null,
          reimbursedBy: null,
          updatedAt: now,
        }).where(inArray(expenses.id, items.map(i => i.expenseId)));
      }
    }

    const [updated] = await tx.update(expensePayments).set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy,
      updatedAt: now,
    }).where(eq(expensePayments.id, paymentId)).returning();

    return updated;
  });
}

export async function revert(paymentId: string) {
  const [payment] = await db.select()
    .from(expensePayments)
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'confirmed') throw new AppError(MSG.NOT_CONFIRMED_REVERT, 400);

  const now = new Date();
  const [updated] = await db.update(expensePayments).set({
    status: 'draft',
    confirmedAt: null,
    confirmedBy: null,
    updatedAt: now,
  }).where(eq(expensePayments.id, paymentId)).returning();

  return updated;
}

export async function remove(paymentId: string) {
  const [payment] = await db.select()
    .from(expensePayments)
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_DELETE, 400);

  await db.delete(expensePayments).where(eq(expensePayments.id, paymentId));
}

export async function list(params: PaginationParams & { userId?: string; status?: string }) {
  const { page, limit, userId, status } = params;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (userId) conditions.push(eq(expensePayments.userId, userId));
  if (status) conditions.push(eq(expensePayments.status, status as 'draft' | 'confirmed' | 'paid' | 'cancelled'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: expensePayments.id,
      userId: expensePayments.userId,
      consultantName: users.name,
      periodStart: expensePayments.periodStart,
      periodEnd: expensePayments.periodEnd,
      status: expensePayments.status,
      totalAmount: expensePayments.totalAmount,
      confirmedAt: expensePayments.confirmedAt,
      paidAt: expensePayments.paidAt,
      cancelledAt: expensePayments.cancelledAt,
      notes: expensePayments.notes,
      createdAt: expensePayments.createdAt,
    })
      .from(expensePayments)
      .innerJoin(users, eq(expensePayments.userId, users.id))
      .where(where)
      .orderBy(desc(expensePayments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expensePayments).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function listMy(userId: string, params: PaginationParams) {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const where = eq(expensePayments.userId, userId);

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: expensePayments.id,
      userId: expensePayments.userId,
      periodStart: expensePayments.periodStart,
      periodEnd: expensePayments.periodEnd,
      status: expensePayments.status,
      totalAmount: expensePayments.totalAmount,
      receiptFileId: expensePayments.receiptFileId,
      confirmedAt: expensePayments.confirmedAt,
      paidAt: expensePayments.paidAt,
      cancelledAt: expensePayments.cancelledAt,
      notes: expensePayments.notes,
      createdAt: expensePayments.createdAt,
    })
      .from(expensePayments)
      .where(where)
      .orderBy(desc(expensePayments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(expensePayments).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getById(paymentId: string, requestUserId: string, requestUserRole: string) {
  const [payment] = await db.select({
    id: expensePayments.id,
    userId: expensePayments.userId,
    consultantName: users.name,
    periodStart: expensePayments.periodStart,
    periodEnd: expensePayments.periodEnd,
    status: expensePayments.status,
    totalAmount: expensePayments.totalAmount,
    receiptFileId: expensePayments.receiptFileId,
    confirmedAt: expensePayments.confirmedAt,
    paidAt: expensePayments.paidAt,
    cancelledAt: expensePayments.cancelledAt,
    notes: expensePayments.notes,
    createdAt: expensePayments.createdAt,
  })
    .from(expensePayments)
    .innerJoin(users, eq(expensePayments.userId, users.id))
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);

  if (requestUserRole !== 'super_admin' && requestUserRole !== 'administrative' && payment.userId !== requestUserId) {
    throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  const items = await db.select({
    id: expensePaymentItems.id,
    expensePaymentId: expensePaymentItems.expensePaymentId,
    expenseId: expensePaymentItems.expenseId,
    amount: expensePaymentItems.amount,
    expenseDescription: expenses.description,
    expenseDate: expenses.date,
    projectName: projects.name,
    categoryName: projectExpenseCategories.name,
  })
    .from(expensePaymentItems)
    .innerJoin(expenses, eq(expensePaymentItems.expenseId, expenses.id))
    .innerJoin(projects, eq(expenses.projectId, projects.id))
    .leftJoin(projectExpenseCategories, eq(expenses.expenseCategoryId, projectExpenseCategories.id))
    .where(eq(expensePaymentItems.expensePaymentId, paymentId));

  return { ...payment, items };
}

export async function getReceipt(paymentId: string, requestUserId: string, requestUserRole: string) {
  const [payment] = await db.select({
    userId: expensePayments.userId,
    receiptFileId: expensePayments.receiptFileId,
  })
    .from(expensePayments)
    .where(eq(expensePayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (!payment.receiptFileId) throw new AppError('Comprovante não encontrado.', 404);

  if (requestUserRole !== 'super_admin' && requestUserRole !== 'administrative' && payment.userId !== requestUserId) {
    throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  return getPresignedUrl(payment.receiptFileId);
}
