import { eq, and, ne, inArray, sql, count as drizzleCount, desc } from 'drizzle-orm';
import { db } from '../db';
import {
  consultantPayments,
  consultantPaymentLines,
  consultantProjectRates,
  monthlyTimesheets,
  timeEntries,
  users,
  projects,
} from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import { getPresignedUrl } from './file.service';

const MSG = {
  TIMESHEET_NOT_APPROVED: 'O timesheet deste consultor para este mês não está aprovado.',
  PAYMENT_EXISTS: 'Já existe um pagamento ativo para este consultor neste mês.',
  NOT_FOUND: 'Pagamento não encontrado.',
  NOT_DRAFT: 'Apenas pagamentos em rascunho podem ser editados.',
  NOT_DRAFT_CONFIRM: 'Apenas pagamentos em rascunho podem ser confirmados.',
  NOT_CONFIRMED: 'Apenas pagamentos confirmados podem ser pagos.',
  ALREADY_CANCELLED: 'Este pagamento já está cancelado.',
  NOT_CONFIRMED_REVERT: 'Apenas pagamentos confirmados podem ser revertidos para rascunho.',
  NOT_DRAFT_DELETE: 'Apenas pagamentos em rascunho podem ser excluídos.',
  ACCESS_DENIED: 'Você não tem acesso a este pagamento.',
  NO_ENTRIES: 'Nenhum lançamento de horas encontrado para este consultor neste mês.',
} as const;

export async function generateDraft(userId: string, year: number, month: number, createdBy: string) {
  return await db.transaction(async (tx) => {
    // Verify timesheet is approved
    const [timesheet] = await tx.select()
      .from(monthlyTimesheets)
      .where(and(
        eq(monthlyTimesheets.userId, userId),
        eq(monthlyTimesheets.year, year),
        eq(monthlyTimesheets.month, month),
      ))
      .limit(1);

    if (!timesheet || timesheet.status !== 'approved') {
      throw new AppError(MSG.TIMESHEET_NOT_APPROVED, 400);
    }

    // Check no active payment exists
    const [existing] = await tx.select({ id: consultantPayments.id })
      .from(consultantPayments)
      .where(and(
        eq(consultantPayments.userId, userId),
        eq(consultantPayments.year, year),
        eq(consultantPayments.month, month),
        ne(consultantPayments.status, 'cancelled'),
      ))
      .limit(1);

    if (existing) throw new AppError(MSG.PAYMENT_EXISTS, 409);

    // Get time entries grouped by project
    const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

    const entries = await tx.select({
      projectId: timeEntries.projectId,
      totalHours: sql<string>`SUM(${timeEntries.hours})`,
    })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        sql`${timeEntries.date} >= ${firstDay}`,
        sql`${timeEntries.date} <= ${lastDay}`,
      ))
      .groupBy(timeEntries.projectId);

    if (entries.length === 0) throw new AppError(MSG.NO_ENTRIES, 400);

    // Get rates for each project
    const projectIds = entries.map(e => e.projectId);
    const rates = await tx.select({
      projectId: consultantProjectRates.projectId,
      costRate: consultantProjectRates.costRate,
    })
      .from(consultantProjectRates)
      .where(and(
        eq(consultantProjectRates.userId, userId),
        inArray(consultantProjectRates.projectId, projectIds),
      ));

    const rateMap = new Map(rates.map(r => [r.projectId, r.costRate]));

    // Create payment
    let totalHours = 0;
    let totalAmount = 0;

    const lines = entries.map(entry => {
      const hours = Number(entry.totalHours);
      const costRate = rateMap.get(entry.projectId) ?? '0';
      const rate = Number(costRate);
      const subtotal = hours * rate;
      totalHours += hours;
      totalAmount += subtotal;

      return {
        projectId: entry.projectId,
        calculatedHours: entry.totalHours,
        appliedHours: entry.totalHours,
        originalRate: costRate,
        appliedRate: costRate,
        subtotal: subtotal.toFixed(2),
      };
    });

    const [payment] = await tx.insert(consultantPayments).values({
      userId,
      year,
      month,
      status: 'draft',
      totalHours: totalHours.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      createdBy,
    }).returning();

    const createdLines = await tx.insert(consultantPaymentLines)
      .values(lines.map(l => ({ ...l, paymentId: payment.id })))
      .returning();

    return { ...payment, lines: createdLines };
  });
}

export async function updateLines(paymentId: string, lines: { id: string; appliedHours: string; appliedRate: string }[], notes?: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(consultantPayments)
      .where(eq(consultantPayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

    let totalHours = 0;
    let totalAmount = 0;

    for (const line of lines) {
      const subtotal = (Number(line.appliedHours) * Number(line.appliedRate)).toFixed(2);
      totalHours += Number(line.appliedHours);
      totalAmount += Number(subtotal);

      await tx.update(consultantPaymentLines).set({
        appliedHours: line.appliedHours,
        appliedRate: line.appliedRate,
        subtotal,
      }).where(eq(consultantPaymentLines.id, line.id));
    }

    const updateData: Record<string, unknown> = {
      totalHours: totalHours.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      updatedAt: new Date(),
    };
    if (notes !== undefined) updateData.notes = notes;

    const [updated] = await tx.update(consultantPayments)
      .set(updateData)
      .where(eq(consultantPayments.id, paymentId))
      .returning();

    return updated;
  });
}

export async function confirm(paymentId: string, confirmedBy: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(consultantPayments)
      .where(eq(consultantPayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_CONFIRM, 400);

    const now = new Date();

    // Lock the timesheet
    await tx.update(monthlyTimesheets).set({
      paymentLocked: true,
      updatedAt: now,
    }).where(and(
      eq(monthlyTimesheets.userId, payment.userId),
      eq(monthlyTimesheets.year, payment.year),
      eq(monthlyTimesheets.month, payment.month),
    ));

    const [updated] = await tx.update(consultantPayments).set({
      status: 'confirmed',
      confirmedAt: now,
      confirmedBy,
      updatedAt: now,
    }).where(eq(consultantPayments.id, paymentId)).returning();

    return updated;
  });
}

export async function pay(paymentId: string, paidBy: string, receiptFileId?: string) {
  const [payment] = await db.select()
    .from(consultantPayments)
    .where(eq(consultantPayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'confirmed') throw new AppError(MSG.NOT_CONFIRMED, 400);

  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: 'paid',
    paidAt: now,
    paidBy,
    updatedAt: now,
  };
  if (receiptFileId) updateData.receiptFileId = receiptFileId;

  const [updated] = await db.update(consultantPayments)
    .set(updateData)
    .where(eq(consultantPayments.id, paymentId))
    .returning();

  return updated;
}

export async function cancel(paymentId: string, cancelledBy: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(consultantPayments)
      .where(eq(consultantPayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status === 'cancelled') throw new AppError(MSG.ALREADY_CANCELLED, 400);

    const now = new Date();

    // Unlock timesheet if it was confirmed or paid
    if (payment.status === 'confirmed' || payment.status === 'paid') {
      await tx.update(monthlyTimesheets).set({
        paymentLocked: false,
        updatedAt: now,
      }).where(and(
        eq(monthlyTimesheets.userId, payment.userId),
        eq(monthlyTimesheets.year, payment.year),
        eq(monthlyTimesheets.month, payment.month),
      ));
    }

    const [updated] = await tx.update(consultantPayments).set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy,
      updatedAt: now,
    }).where(eq(consultantPayments.id, paymentId)).returning();

    return updated;
  });
}

export async function revert(paymentId: string) {
  return await db.transaction(async (tx) => {
    const [payment] = await tx.select()
      .from(consultantPayments)
      .where(eq(consultantPayments.id, paymentId))
      .limit(1);

    if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
    if (payment.status !== 'confirmed') throw new AppError(MSG.NOT_CONFIRMED_REVERT, 400);

    const now = new Date();

    // Unlock timesheet
    await tx.update(monthlyTimesheets).set({
      paymentLocked: false,
      updatedAt: now,
    }).where(and(
      eq(monthlyTimesheets.userId, payment.userId),
      eq(monthlyTimesheets.year, payment.year),
      eq(monthlyTimesheets.month, payment.month),
    ));

    const [updated] = await tx.update(consultantPayments).set({
      status: 'draft',
      confirmedAt: null,
      confirmedBy: null,
      updatedAt: now,
    }).where(eq(consultantPayments.id, paymentId)).returning();

    return updated;
  });
}

export async function remove(paymentId: string) {
  const [payment] = await db.select()
    .from(consultantPayments)
    .where(eq(consultantPayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (payment.status !== 'draft') throw new AppError(MSG.NOT_DRAFT_DELETE, 400);

  await db.delete(consultantPayments).where(eq(consultantPayments.id, paymentId));
}

export async function list(params: PaginationParams & { userId?: string; year?: number; month?: number; status?: string }) {
  const { page, limit, userId, year, month, status } = params;
  const offset = (page - 1) * limit;

  const conditions: ReturnType<typeof eq>[] = [];
  if (userId) conditions.push(eq(consultantPayments.userId, userId));
  if (year) conditions.push(eq(consultantPayments.year, year));
  if (month) conditions.push(eq(consultantPayments.month, month));
  if (status) conditions.push(eq(consultantPayments.status, status as 'draft' | 'confirmed' | 'paid' | 'cancelled'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: consultantPayments.id,
      userId: consultantPayments.userId,
      consultantName: users.name,
      year: consultantPayments.year,
      month: consultantPayments.month,
      status: consultantPayments.status,
      totalHours: consultantPayments.totalHours,
      totalAmount: consultantPayments.totalAmount,
      confirmedAt: consultantPayments.confirmedAt,
      paidAt: consultantPayments.paidAt,
      cancelledAt: consultantPayments.cancelledAt,
      notes: consultantPayments.notes,
      createdAt: consultantPayments.createdAt,
    })
      .from(consultantPayments)
      .innerJoin(users, eq(consultantPayments.userId, users.id))
      .where(where)
      .orderBy(desc(consultantPayments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(consultantPayments).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function listMy(userId: string, params: PaginationParams) {
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const where = eq(consultantPayments.userId, userId);

  const [data, [{ total }]] = await Promise.all([
    db.select({
      id: consultantPayments.id,
      userId: consultantPayments.userId,
      year: consultantPayments.year,
      month: consultantPayments.month,
      status: consultantPayments.status,
      totalHours: consultantPayments.totalHours,
      totalAmount: consultantPayments.totalAmount,
      receiptFileId: consultantPayments.receiptFileId,
      confirmedAt: consultantPayments.confirmedAt,
      paidAt: consultantPayments.paidAt,
      cancelledAt: consultantPayments.cancelledAt,
      notes: consultantPayments.notes,
      createdAt: consultantPayments.createdAt,
    })
      .from(consultantPayments)
      .where(where)
      .orderBy(desc(consultantPayments.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(consultantPayments).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function getById(paymentId: string, requestUserId: string, requestUserRole: string) {
  const [payment] = await db.select({
    id: consultantPayments.id,
    userId: consultantPayments.userId,
    consultantName: users.name,
    year: consultantPayments.year,
    month: consultantPayments.month,
    status: consultantPayments.status,
    totalHours: consultantPayments.totalHours,
    totalAmount: consultantPayments.totalAmount,
    receiptFileId: consultantPayments.receiptFileId,
    confirmedAt: consultantPayments.confirmedAt,
    paidAt: consultantPayments.paidAt,
    cancelledAt: consultantPayments.cancelledAt,
    notes: consultantPayments.notes,
    createdAt: consultantPayments.createdAt,
  })
    .from(consultantPayments)
    .innerJoin(users, eq(consultantPayments.userId, users.id))
    .where(eq(consultantPayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);

  // Access check
  if (requestUserRole !== 'super_admin' && requestUserRole !== 'administrative' && payment.userId !== requestUserId) {
    throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  const lines = await db.select({
    id: consultantPaymentLines.id,
    paymentId: consultantPaymentLines.paymentId,
    projectId: consultantPaymentLines.projectId,
    projectName: projects.name,
    calculatedHours: consultantPaymentLines.calculatedHours,
    appliedHours: consultantPaymentLines.appliedHours,
    originalRate: consultantPaymentLines.originalRate,
    appliedRate: consultantPaymentLines.appliedRate,
    subtotal: consultantPaymentLines.subtotal,
  })
    .from(consultantPaymentLines)
    .innerJoin(projects, eq(consultantPaymentLines.projectId, projects.id))
    .where(eq(consultantPaymentLines.paymentId, paymentId));

  return { ...payment, lines };
}

export async function getReceipt(paymentId: string, requestUserId: string, requestUserRole: string) {
  const [payment] = await db.select({
    userId: consultantPayments.userId,
    receiptFileId: consultantPayments.receiptFileId,
  })
    .from(consultantPayments)
    .where(eq(consultantPayments.id, paymentId))
    .limit(1);

  if (!payment) throw new AppError(MSG.NOT_FOUND, 404);
  if (!payment.receiptFileId) throw new AppError('Comprovante não encontrado.', 404);

  if (requestUserRole !== 'super_admin' && requestUserRole !== 'administrative' && payment.userId !== requestUserId) {
    throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  return getPresignedUrl(payment.receiptFileId);
}
