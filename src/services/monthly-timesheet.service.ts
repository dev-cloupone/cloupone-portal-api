import { eq, and, sql, count as drizzleCount, lt, desc } from 'drizzle-orm';
import { db } from '../db';
import { monthlyTimesheets, timeEntries, users, projects, tickets } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';

const MSG = {
  NOT_FOUND: 'Timesheet mensal não encontrado.',
  ALREADY_APPROVED: 'Este mês já está aprovado.',
  NOT_APPROVED: 'Apenas meses aprovados podem ser reabertos.',
  NOT_OPEN: 'Este mês não está aberto para edição.',
  FORBIDDEN: 'Você não tem permissão para esta ação.',
  REASON_REQUIRED: 'Motivo da reabertura é obrigatório.',
} as const;

export async function getIfExists(userId: string, year: number, month: number) {
  const [existing] = await db
    .select()
    .from(monthlyTimesheets)
    .where(
      and(
        eq(monthlyTimesheets.userId, userId),
        eq(monthlyTimesheets.year, year),
        eq(monthlyTimesheets.month, month),
      ),
    );

  return existing ?? null;
}

export async function getOrCreate(userId: string, year: number, month: number) {
  const [existing] = await db
    .select()
    .from(monthlyTimesheets)
    .where(
      and(
        eq(monthlyTimesheets.userId, userId),
        eq(monthlyTimesheets.year, year),
        eq(monthlyTimesheets.month, month),
      ),
    );

  if (existing) return existing;

  const [created] = await db
    .insert(monthlyTimesheets)
    .values({ userId, year, month, status: 'open' })
    .returning();

  return created;
}

interface ListFilters extends PaginationParams {
  year?: number;
  month?: number;
  userId?: string;
  status?: string;
}

export async function list(filters: ListFilters) {
  const conditions = [];

  if (filters.year) conditions.push(eq(monthlyTimesheets.year, filters.year));
  if (filters.month) conditions.push(eq(monthlyTimesheets.month, filters.month));
  if (filters.userId) conditions.push(eq(monthlyTimesheets.userId, filters.userId));
  if (filters.status) conditions.push(eq(monthlyTimesheets.status, filters.status as 'open' | 'approved' | 'reopened'));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: drizzleCount() })
    .from(monthlyTimesheets)
    .where(where);

  const offset = (filters.page - 1) * filters.limit;

  const data = await db
    .select({
      id: monthlyTimesheets.id,
      userId: monthlyTimesheets.userId,
      year: monthlyTimesheets.year,
      month: monthlyTimesheets.month,
      status: monthlyTimesheets.status,
      approvedAt: monthlyTimesheets.approvedAt,
      approvedById: monthlyTimesheets.approvedById,
      reopenedAt: monthlyTimesheets.reopenedAt,
      reopenedById: monthlyTimesheets.reopenedById,
      reopenReason: monthlyTimesheets.reopenReason,
      escalatedAt: monthlyTimesheets.escalatedAt,
      createdAt: monthlyTimesheets.createdAt,
      updatedAt: monthlyTimesheets.updatedAt,
      consultantName: users.name,
      totalHours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
    })
    .from(monthlyTimesheets)
    .innerJoin(users, eq(monthlyTimesheets.userId, users.id))
    .leftJoin(
      timeEntries,
      and(
        eq(timeEntries.userId, monthlyTimesheets.userId),
        sql`EXTRACT(YEAR FROM ${timeEntries.date})::integer = ${monthlyTimesheets.year}`,
        sql`EXTRACT(MONTH FROM ${timeEntries.date})::integer = ${monthlyTimesheets.month}`,
      ),
    )
    .where(where)
    .groupBy(monthlyTimesheets.id, users.name)
    .orderBy(desc(monthlyTimesheets.year), desc(monthlyTimesheets.month), users.name)
    .limit(filters.limit)
    .offset(offset);

  return { data, meta: buildMeta(total, filters) };
}

export async function getDetail(userId: string, year: number, month: number) {
  const timesheet = await getOrCreate(userId, year, month);

  const entries = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      projectId: timeEntries.projectId,
      date: timeEntries.date,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      hours: timeEntries.hours,
      description: timeEntries.description,
      ticketId: timeEntries.ticketId,
      createdAt: timeEntries.createdAt,
      updatedAt: timeEntries.updatedAt,
      projectName: projects.name,
      ticketCode: tickets.code,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(
      and(
        eq(timeEntries.userId, userId),
        sql`EXTRACT(YEAR FROM ${timeEntries.date})::integer = ${year}`,
        sql`EXTRACT(MONTH FROM ${timeEntries.date})::integer = ${month}`,
      ),
    )
    .orderBy(timeEntries.date, timeEntries.startTime);

  return { timesheet, entries };
}

export async function getPending(userId: string) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const data = await db
    .select({
      userId: monthlyTimesheets.userId,
      year: monthlyTimesheets.year,
      month: monthlyTimesheets.month,
      status: monthlyTimesheets.status,
      reopenReason: monthlyTimesheets.reopenReason,
    })
    .from(monthlyTimesheets)
    .where(
      and(
        eq(monthlyTimesheets.userId, userId),
        sql`${monthlyTimesheets.status} IN ('open', 'reopened')`,
        sql`(${monthlyTimesheets.year} < ${currentYear} OR (${monthlyTimesheets.year} = ${currentYear} AND ${monthlyTimesheets.month} < ${currentMonth}))`,
      ),
    )
    .orderBy(desc(monthlyTimesheets.year), desc(monthlyTimesheets.month));

  return data;
}

export async function approve(userId: string, year: number, month: number, approvedById: string) {
  const timesheet = await getOrCreate(userId, year, month);

  if (timesheet.status === 'approved') {
    throw new AppError(MSG.ALREADY_APPROVED, 400);
  }

  const [updated] = await db
    .update(monthlyTimesheets)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      approvedById,
      reopenedAt: null,
      reopenedById: null,
      reopenReason: null,
      updatedAt: new Date(),
    })
    .where(eq(monthlyTimesheets.id, timesheet.id))
    .returning();

  return updated;
}

export async function reopen(userId: string, year: number, month: number, reopenedById: string, reason: string) {
  if (!reason?.trim()) {
    throw new AppError(MSG.REASON_REQUIRED, 400);
  }

  const timesheet = await getOrCreate(userId, year, month);

  if (timesheet.status !== 'approved') {
    throw new AppError(MSG.NOT_APPROVED, 400);
  }

  const [updated] = await db
    .update(monthlyTimesheets)
    .set({
      status: 'reopened',
      reopenedAt: new Date(),
      reopenedById,
      reopenReason: reason.trim(),
      approvedAt: null,
      approvedById: null,
      updatedAt: new Date(),
    })
    .where(eq(monthlyTimesheets.id, timesheet.id))
    .returning();

  return updated;
}

export async function isMonthOpen(userId: string, year: number, month: number): Promise<boolean> {
  const [existing] = await db
    .select({ status: monthlyTimesheets.status })
    .from(monthlyTimesheets)
    .where(
      and(
        eq(monthlyTimesheets.userId, userId),
        eq(monthlyTimesheets.year, year),
        eq(monthlyTimesheets.month, month),
      ),
    );

  if (!existing) return true; // No record means month is open (will be created on first entry)
  return existing.status === 'open' || existing.status === 'reopened';
}

export async function runEscalation() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Find months that are open and belong to previous months (at least 3 business days into current month)
  const dayOfMonth = now.getDate();
  // Simple heuristic: 3 business days ≈ day 5 of the month (accounting for weekends)
  if (dayOfMonth < 5) {
    return { escalated: 0 };
  }

  const timesheets = await db
    .select({
      id: monthlyTimesheets.id,
      userId: monthlyTimesheets.userId,
      year: monthlyTimesheets.year,
      month: monthlyTimesheets.month,
    })
    .from(monthlyTimesheets)
    .where(
      and(
        eq(monthlyTimesheets.status, 'open'),
        sql`${monthlyTimesheets.escalatedAt} IS NULL`,
        sql`(${monthlyTimesheets.year} < ${currentYear} OR (${monthlyTimesheets.year} = ${currentYear} AND ${monthlyTimesheets.month} < ${currentMonth}))`,
      ),
    );

  if (timesheets.length === 0) {
    return { escalated: 0 };
  }

  for (const ts of timesheets) {
    await db
      .update(monthlyTimesheets)
      .set({ escalatedAt: new Date(), updatedAt: new Date() })
      .where(eq(monthlyTimesheets.id, ts.id));
  }

  return { escalated: timesheets.length };
}
