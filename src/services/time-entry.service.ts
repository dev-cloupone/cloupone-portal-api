import { eq, and, between, count as drizzleCount, desc, asc, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { timeEntries, timeEntryComments, projects, activityCategories, projectAllocations, users, clients, tickets, consultantProfiles } from '../db/schema';
import { AppError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import { notifyEntryRejected, notifyWeekApproved } from './notification.service';

const MSG = {
  NOT_FOUND: 'Apontamento não encontrado.',
  NOT_OWNER: 'Você não pode editar apontamentos de outro consultor.',
  NOT_DRAFT: 'Apenas apontamentos em rascunho podem ser editados.',
  NOT_DRAFT_OR_REJECTED: 'Apenas apontamentos em rascunho ou rejeitados podem ser editados.',
  NOT_REJECTED: 'Apenas apontamentos rejeitados podem ser resubmetidos.',
  NOT_SUBMITTED: 'Apenas apontamentos submetidos podem ser aprovados ou rejeitados.',
  NOT_ALLOCATED: 'Consultor não está alocado neste projeto.',
  NO_ENTRIES: 'Nenhum apontamento encontrado para submeter nesta semana.',
  COMMENT_REQUIRED: 'Comentário é obrigatório ao rejeitar um apontamento.',
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
    sql`${timeEntries.status} != 'rejected'`,
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

async function getRequiresApproval(userId: string): Promise<boolean> {
  const profile = await db
    .select({ requiresApproval: consultantProfiles.requiresApproval })
    .from(consultantProfiles)
    .where(eq(consultantProfiles.userId, userId))
    .limit(1);

  return profile[0]?.requiresApproval ?? false;
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
      status: timeEntries.status,
      submittedAt: timeEntries.submittedAt,
      approvedAt: timeEntries.approvedAt,
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

  const rejectedIds = entries.filter(e => e.status === 'rejected').map(e => e.id);
  let commentsMap: Record<string, string> = {};

  if (rejectedIds.length > 0) {
    const comments = await db
      .select({
        timeEntryId: timeEntryComments.timeEntryId,
        content: timeEntryComments.content,
      })
      .from(timeEntryComments)
      .where(inArray(timeEntryComments.timeEntryId, rejectedIds))
      .orderBy(desc(timeEntryComments.createdAt));

    for (const c of comments) {
      if (!commentsMap[c.timeEntryId]) {
        commentsMap[c.timeEntryId] = c.content;
      }
    }
  }

  const entriesWithComments = entries.map(e => ({
    ...e,
    rejectionComment: commentsMap[e.id] ?? null,
  }));

  const workingDays = countWorkingDays(firstDay, lastDay);
  const targetHours = workingDays * 8;
  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return {
    month: date,
    entries: entriesWithComments,
    totalHours,
    targetHours,
    workingDays,
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
      status: timeEntries.status,
      submittedAt: timeEntries.submittedAt,
      approvedAt: timeEntries.approvedAt,
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

  // Fetch latest rejection comment for rejected entries
  const rejectedIds = entries.filter(e => e.status === 'rejected').map(e => e.id);
  let commentsMap: Record<string, string> = {};

  if (rejectedIds.length > 0) {
    const comments = await db
      .select({
        timeEntryId: timeEntryComments.timeEntryId,
        content: timeEntryComments.content,
      })
      .from(timeEntryComments)
      .where(inArray(timeEntryComments.timeEntryId, rejectedIds))
      .orderBy(desc(timeEntryComments.createdAt));

    for (const c of comments) {
      if (!commentsMap[c.timeEntryId]) {
        commentsMap[c.timeEntryId] = c.content;
      }
    }
  }

  const entriesWithComments = entries.map(e => ({
    ...e,
    rejectionComment: commentsMap[e.id] ?? null,
  }));

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  return {
    weekStartDate,
    entries: entriesWithComments,
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

  // 3. Validate project allocation
  const [allocation] = await db
    .select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(
      eq(projectAllocations.projectId, data.projectId),
      eq(projectAllocations.userId, data.userId),
    ))
    .limit(1);

  if (!allocation) throw new AppError(MSG.NOT_ALLOCATED, 400);

  // 4. Validate ticket belongs to project (if provided)
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

  // 5. Calculate hours
  const hours = calculateHours(startTime, endTime);

  // 6. If update, verify ownership and status
  if (data.id) {
    const [existing] = await db.select()
      .from(timeEntries)
      .where(eq(timeEntries.id, data.id))
      .limit(1);

    if (!existing) throw new AppError(MSG.NOT_FOUND, 404);
    if (existing.userId !== data.userId) throw new AppError(MSG.NOT_OWNER, 403);
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      throw new AppError(MSG.NOT_DRAFT_OR_REJECTED, 400);
    }

    // 7. Validate overlap (excluding self)
    await validateOverlap(data.userId, data.date, startTime, endTime, data.id);

    // 8. Update
    const [updated] = await db.update(timeEntries).set({
      projectId: data.projectId,
      categoryId: data.categoryId ?? null,
      date: data.date,
      startTime,
      endTime,
      hours,
      description: data.description ?? null,
      ticketId: data.ticketId ?? null,
      status: 'draft',
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, data.id)).returning();

    return updated;
  }

  // Insert path:
  // 7. Validate overlap
  await validateOverlap(data.userId, data.date, startTime, endTime);

  // 8. Insert
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
  if (entry.status !== 'draft') throw new AppError(MSG.NOT_DRAFT, 400);

  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

export async function submitWeek(userId: string, weekStartDate: string) {
  const weekEnd = getWeekEndDate(weekStartDate);

  const draftEntries = await db
    .select()
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, weekStartDate, weekEnd),
      eq(timeEntries.status, 'draft'),
    ));

  if (draftEntries.length === 0) throw new AppError(MSG.NO_ENTRIES, 400);

  const requiresApproval = await getRequiresApproval(userId);
  const now = new Date();
  const draftEntryIds = draftEntries.map(e => e.id);

  if (requiresApproval) {
    await db.update(timeEntries).set({
      status: 'submitted',
      submittedAt: now,
      updatedAt: now,
    }).where(inArray(timeEntries.id, draftEntryIds));
  } else {
    await db.update(timeEntries).set({
      status: 'auto_approved',
      submittedAt: now,
      approvedAt: now,
      approvedBy: null,
      updatedAt: now,
    }).where(inArray(timeEntries.id, draftEntryIds));
  }

  // Build warnings
  const warnings: string[] = [];
  const totalHours = draftEntries.reduce((sum, e) => sum + Number(e.hours), 0);
  if (totalHours < 40) {
    warnings.push(`Total de horas (${totalHours}h) está abaixo da meta semanal (40h).`);
  }

  // Check days without entries
  const entryDates = new Set(draftEntries.map(e => e.date));
  const weekDays = [];
  const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStartDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const dayIndex = d.getDay();
    weekDays.push({ date: dateStr, dayName: dayNames[dayIndex] });
  }
  const missingDays = weekDays.filter(d => !entryDates.has(d.date));
  if (missingDays.length > 0) {
    warnings.push(`Sem apontamento em: ${missingDays.map(d => d.dayName).join(', ')}.`);
  }

  // Check days with >12h
  const hoursByDate = new Map<string, number>();
  for (const e of draftEntries) {
    hoursByDate.set(e.date, (hoursByDate.get(e.date) ?? 0) + Number(e.hours));
  }
  for (const [date, dayHours] of hoursByDate) {
    if (dayHours > 12) {
      const d = new Date(date + 'T12:00:00');
      const dayName = dayNames[d.getDay()];
      warnings.push(`${dayName} tem mais de 12h registradas (${dayHours.toFixed(1)}h).`);
    }
  }

  return { submitted: draftEntries.length, warnings, autoApproved: !requiresApproval };
}

export async function submitEntry(entryId: string, userId: string) {
  const [entry] = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.id, entryId),
        eq(timeEntries.userId, userId),
        eq(timeEntries.status, 'draft'),
      ),
    )
    .limit(1);

  if (!entry) {
    throw new AppError('Entry not found or not in draft status', 404);
  }

  const requiresApproval = await getRequiresApproval(userId);
  const now = new Date();

  if (requiresApproval) {
    await db
      .update(timeEntries)
      .set({ status: 'submitted', submittedAt: now, updatedAt: now })
      .where(eq(timeEntries.id, entryId));

    return { status: 'submitted' as const };
  } else {
    await db
      .update(timeEntries)
      .set({
        status: 'auto_approved',
        submittedAt: now,
        approvedAt: now,
        approvedBy: null,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, entryId));

    return { status: 'auto_approved' as const };
  }
}

export async function listPendingApprovals(params: PaginationParams & { consultantId?: string }) {
  const { page, limit, consultantId } = params;
  const offset = (page - 1) * limit;

  const conditions = [eq(timeEntries.status, 'submitted')];
  if (consultantId) conditions.push(eq(timeEntries.userId, consultantId));

  const where = and(...conditions);

  const [data, [{ total }]] = await Promise.all([
    db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        userName: users.name,
        userEmail: users.email,
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
        status: timeEntries.status,
        submittedAt: timeEntries.submittedAt,
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
      .orderBy(timeEntries.submittedAt, timeEntries.date, asc(timeEntries.startTime))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(timeEntries).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

export async function approveEntries(entryIds: string[], approvedBy: string) {
  const entries = await db
    .select({ id: timeEntries.id, status: timeEntries.status })
    .from(timeEntries)
    .where(inArray(timeEntries.id, entryIds));

  const notSubmitted = entries.filter(e => e.status !== 'submitted');
  if (notSubmitted.length > 0) throw new AppError(MSG.NOT_SUBMITTED, 400);

  const now = new Date();
  await db.update(timeEntries).set({
    status: 'approved',
    approvedAt: now,
    approvedBy,
    updatedAt: now,
  }).where(inArray(timeEntries.id, entryIds));

  notifyWeekApproved(entryIds, approvedBy);

  return { approved: entryIds.length };
}

export async function rejectEntry(entryId: string, rejectedBy: string, comment: string) {
  if (!comment.trim()) throw new AppError(MSG.COMMENT_REQUIRED, 400);

  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);
  if (entry.status !== 'submitted') throw new AppError(MSG.NOT_SUBMITTED, 400);

  await db.transaction(async (tx) => {
    await tx.update(timeEntries).set({
      status: 'rejected',
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, entryId));

    await tx.insert(timeEntryComments).values({
      timeEntryId: entryId,
      userId: rejectedBy,
      content: comment,
    });
  });

  notifyEntryRejected(entryId, comment, rejectedBy);
}

export async function resubmitEntry(entryId: string, userId: string) {
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, entryId)).limit(1);
  if (!entry) throw new AppError(MSG.NOT_FOUND, 404);
  if (entry.userId !== userId) throw new AppError(MSG.NOT_OWNER, 403);
  if (entry.status !== 'rejected') throw new AppError(MSG.NOT_REJECTED, 400);

  const [updated] = await db.update(timeEntries).set({
    status: 'submitted',
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(timeEntries.id, entryId)).returning();

  return updated;
}

export async function listTimeEntries(params: PaginationParams & {
  userId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  status?: string;
}) {
  const { page, limit, userId, projectId, from, to, status } = params;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (userId) conditions.push(eq(timeEntries.userId, userId));
  if (projectId) conditions.push(eq(timeEntries.projectId, projectId));
  if (status) conditions.push(eq(timeEntries.status, status as 'draft' | 'submitted' | 'approved' | 'rejected' | 'auto_approved'));
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
        status: timeEntries.status,
        submittedAt: timeEntries.submittedAt,
        approvedAt: timeEntries.approvedAt,
        approvedBy: timeEntries.approvedBy,
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
