import { eq, and, between, count as drizzleCount, desc, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { timeEntries, projects, activityCategories, projectAllocations, users, clients, tickets, consultantProfiles, monthlyTimesheets } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import * as monthlyTimesheetService from './monthly-timesheet.service';

const MSG = {
  NOT_FOUND: 'Apontamento não encontrado.',
  NOT_OWNER: 'Você não pode editar apontamentos de outro consultor.',
  MONTH_CLOSED: 'Mês aprovado. Não é possível editar apontamentos.',
  NOT_ALLOCATED: 'Consultor não está alocado neste projeto.',
} as const;

// --- Time utility functions ---

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function calculateHours(startTime: string, endTime: string): string {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  return ((endMin - startMin) / 60).toFixed(2);
}

function roundToFiveMinutes(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const rounded = Math.round(m / 5) * 5;
  const finalH = rounded === 60 ? h + 1 : h;
  const finalM = rounded === 60 ? 0 : rounded;
  return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
}

function validateTimeRange(startTime: string, endTime: string): void {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);

  if (startMin >= endMin) {
    throw new AppError('Horário de início deve ser anterior ao horário de fim.', 400);
  }

  const duration = endMin - startMin;
  if (duration < 15) {
    throw new AppError('Duração mínima de 15 minutos.', 400);
  }
}

async function validateOverlap(
  userId: string,
  date: string,
  startTime: string,
  endTime: string,
  excludeEntryId?: string,
): Promise<void> {
  const profile = await db.select()
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, userId))
    .limit(1);

  if (profile[0]?.allowOverlappingEntries) return;

  const conditions = [
    eq(timeEntries.userId, userId),
    eq(timeEntries.date, date),
    sql`${timeEntries.startTime} < ${endTime}::time`,
    sql`${timeEntries.endTime} > ${startTime}::time`,
  ];

  if (excludeEntryId) {
    conditions.push(sql`${timeEntries.id} != ${excludeEntryId}`);
  }

  const overlapping = await db.select({
    id: timeEntries.id,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
  })
    .from(timeEntries)
    .where(and(...conditions))
    .limit(1);

  if (overlapping.length > 0) {
    const entry = overlapping[0];
    throw new AppError(
      `Sobreposição detectada com registro das ${entry.startTime} às ${entry.endTime}.`,
      409,
    );
  }
}

// --- Helper to extract year/month from date string ---

function extractYearMonth(dateStr: string): { year: number; month: number } {
  const d = new Date(dateStr + 'T12:00:00');
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// --- Core functions ---

function getWeekEndDate(weekStartDate: string): string {
  const start = new Date(weekStartDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end.toISOString().split('T')[0];
}

function countWorkingDays(firstDay: Date, lastDay: Date): number {
  let count = 0;
  const d = new Date(firstDay);
  while (d <= lastDay) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export async function getMonthEntries(userId: string, date: string) {
  const [yearStr, monthStr] = date.split('-');
  const year = parseInt(yearStr);
  const month = parseInt(monthStr) - 1;
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const firstDayStr = firstDay.toISOString().split('T')[0];
  const lastDayStr = lastDay.toISOString().split('T')[0];

  const entries = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      clientName: clients.companyName,
      categoryId: timeEntries.categoryId,
      categoryName: activityCategories.name,
      date: timeEntries.date,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      hours: timeEntries.hours,
      description: timeEntries.description,
      createdAt: timeEntries.createdAt,
      updatedAt: timeEntries.updatedAt,
      ticketId: timeEntries.ticketId,
      ticketCode: tickets.code,
      ticketTitle: tickets.title,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, firstDayStr, lastDayStr),
    ))
    .orderBy(asc(timeEntries.date), asc(timeEntries.startTime));

  // Get monthly timesheet status (month was decremented above for Date constructor, so +1 to get back to 1-based)
  const timesheet = await monthlyTimesheetService.getIfExists(userId, year, month + 1);

  const workingDays = countWorkingDays(firstDay, lastDay);
  const targetHours = workingDays * 8;
  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return {
    month: date,
    entries,
    totalHours,
    targetHours,
    workingDays,
    monthlyTimesheet: timesheet
      ? {
          id: timesheet.id,
          status: timesheet.status,
          approvedAt: timesheet.approvedAt,
          reopenReason: timesheet.reopenReason,
        }
      : null,
  };
}

export async function getWeekEntries(userId: string, weekStartDate: string) {
  const weekEnd = getWeekEndDate(weekStartDate);

  const entries = await db
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      projectId: timeEntries.projectId,
      projectName: projects.name,
      clientName: clients.companyName,
      categoryId: timeEntries.categoryId,
      categoryName: activityCategories.name,
      date: timeEntries.date,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      hours: timeEntries.hours,
      description: timeEntries.description,
      createdAt: timeEntries.createdAt,
      updatedAt: timeEntries.updatedAt,
      ticketId: timeEntries.ticketId,
      ticketCode: tickets.code,
      ticketTitle: tickets.title,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, weekStartDate, weekEnd),
    ))
    .orderBy(asc(timeEntries.date), asc(timeEntries.startTime));

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return {
    weekStartDate,
    entries,
    totalHours,
    targetHours: 40,
  };
}

interface UpsertEntryInput {
  userId: string;
  id?: string;
  projectId: string;
  categoryId?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  description?: string;
  ticketId?: string | null;
}

export async function upsertTimeEntry(data: UpsertEntryInput) {
  // 1. Round times to 5-minute increments
  const startTime = roundToFiveMinutes(data.startTime);
  const endTime = roundToFiveMinutes(data.endTime);

  // 2. Validate time range
  validateTimeRange(startTime, endTime);

  // 3. Validate month is open
  const { year, month } = extractYearMonth(data.date);
  const isOpen = await monthlyTimesheetService.isMonthOpen(data.userId, year, month);
  if (!isOpen) throw new AppError(MSG.MONTH_CLOSED, 400);

  // 4. Validate project allocation
  const [allocation] = await db
    .select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(
      eq(projectAllocations.projectId, data.projectId),
      eq(projectAllocations.userId, data.userId),
    ))
    .limit(1);

  if (!allocation) throw new AppError(MSG.NOT_ALLOCATED, 400);

  // 5. Validate ticket belongs to project (if provided)
  if (data.ticketId) {
    const [ticket] = await db
      .select({ projectId: tickets.projectId })
      .from(tickets)
      .where(eq(tickets.id, data.ticketId))
      .limit(1);
    if (!ticket) throw new AppError('Ticket não encontrado.', 404);
    if (ticket.projectId !== data.projectId) {
      throw new AppError('Ticket não pertence ao projeto selecionado.', 400);
    }
  }

  // 6. Calculate hours
  const hours = calculateHours(startTime, endTime);

  // 7. If update, verify ownership
  if (data.id) {
    const [existing] = await db.select()
      .from(timeEntries)
      .where(eq(timeEntries.id, data.id))
      .limit(1);

    if (!existing) throw new AppError(MSG.NOT_FOUND, 404);
    if (existing.userId !== data.userId) throw new AppError(MSG.NOT_OWNER, 403);

    // 8. Validate overlap (excluding self)
    await validateOverlap(data.userId, data.date, startTime, endTime, data.id);

    // 9. Update
    const [updated] = await db.update(timeEntries).set({
      projectId: data.projectId,
      categoryId: data.categoryId ?? null,
      date: data.date,
      startTime,
      endTime,
      hours,
      description: data.description ?? null,
      ticketId: data.ticketId ?? null,
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, data.id)).returning();

    return updated;
  }

  // Insert path:
  // 8. Validate overlap
  await validateOverlap(data.userId, data.date, startTime, endTime);

  // 9. Ensure monthly timesheet exists
  await monthlyTimesheetService.getOrCreate(data.userId, year, month);

  // 10. Insert
  const [created] = await db.insert(timeEntries).values({
    userId: data.userId,
    projectId: data.projectId,
    categoryId: data.categoryId ?? null,
    date: data.date,
    startTime,
    endTime,
    hours,
    description: data.description ?? null,
    ticketId: data.ticketId ?? null,
  }).returning();

  return created;
}

export async function deleteTimeEntry(id: string, userId: string) {
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);
  if (entry.userId !== userId) throw new AppError(MSG.NOT_OWNER, 403);

  // Validate month is open
  const { year, month } = extractYearMonth(entry.date);
  const isOpen = await monthlyTimesheetService.isMonthOpen(userId, year, month);
  if (!isOpen) throw new AppError(MSG.MONTH_CLOSED, 400);

  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

export async function listTimeEntries(params: PaginationParams & {
  userId?: string;
  projectId?: string;
  from?: string;
  to?: string;
}) {
  const { page, limit, userId, projectId, from, to } = params;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (userId) conditions.push(eq(timeEntries.userId, userId));
  if (projectId) conditions.push(eq(timeEntries.projectId, projectId));
  if (from && to) conditions.push(between(timeEntries.date, from, to));
  else if (from) conditions.push(sql`${timeEntries.date} >= ${from}`);
  else if (to) conditions.push(sql`${timeEntries.date} <= ${to}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        userName: users.name,
        projectId: timeEntries.projectId,
        projectName: projects.name,
        clientName: clients.companyName,
        categoryId: timeEntries.categoryId,
        categoryName: activityCategories.name,
        date: timeEntries.date,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        hours: timeEntries.hours,
        description: timeEntries.description,
        createdAt: timeEntries.createdAt,
        ticketId: timeEntries.ticketId,
        ticketCode: tickets.code,
        ticketTitle: tickets.title,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(activityCategories, eq(timeEntries.categoryId, activityCategories.id))
      .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
      .where(where)
      .orderBy(desc(timeEntries.date), asc(timeEntries.startTime))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(timeEntries).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}
