import { eq, and, between, count as drizzleCount, desc, asc, sql, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { timeEntries, projects, projectAllocations, users, clients, tickets, consultantProfiles, monthlyTimesheets, projectSubphases, projectPhases, subphaseConsultants } from '../db/schema';
import { appError } from '../utils/app-error';
import type { PaginationParams } from '../types/pagination.types';
import { buildMeta } from '../utils/pagination';
import * as monthlyTimesheetService from './monthly-timesheet.service';

const MSG = {
  NOT_FOUND: { message: 'Apontamento não encontrado.', code: 'TIME_ENTRY_NOT_FOUND' },
  NOT_OWNER: { message: 'Você não pode editar apontamentos de outro consultor.', code: 'TIME_ENTRY_NOT_OWNER' },
  MONTH_CLOSED: { message: 'Mês aprovado. Não é possível editar apontamentos.', code: 'TIME_ENTRY_MONTH_CLOSED' },
  NOT_ALLOCATED: { message: 'Consultor não está alocado neste projeto.', code: 'TIME_ENTRY_NOT_ALLOCATED' },
  SUBPHASE_REQUIRED: { message: 'Subfase é obrigatória para novos apontamentos.', code: 'TIME_ENTRY_SUBPHASE_REQUIRED' },
  SUBPHASE_NOT_FOUND: { message: 'Subfase não encontrada.', code: 'TIME_ENTRY_SUBPHASE_NOT_FOUND' },
  SUBPHASE_NOT_IN_PROGRESS: { message: 'Subfase não está em andamento.', code: 'TIME_ENTRY_SUBPHASE_NOT_IN_PROGRESS' },
  NOT_LINKED_TO_SUBPHASE: { message: 'Consultor não está vinculado a esta subfase.', code: 'TIME_ENTRY_NOT_LINKED_TO_SUBPHASE' },
  SUBPHASE_NOT_IN_PROJECT: { message: 'Subfase não pertence ao projeto selecionado.', code: 'TIME_ENTRY_SUBPHASE_NOT_IN_PROJECT' },
  START_BEFORE_END: { message: 'Horário de início deve ser anterior ao horário de fim.', code: 'TIME_ENTRY_START_BEFORE_END' },
  MIN_DURATION: { message: 'Duração mínima de 15 minutos.', code: 'TIME_ENTRY_MIN_DURATION' },
  OVERLAP: { message: 'Sobreposição detectada com outro registro.', code: 'TIME_ENTRY_OVERLAP' },
  TICKET_NOT_FOUND: { message: 'Ticket não encontrado.', code: 'TIME_ENTRY_TICKET_NOT_FOUND' },
  TICKET_NOT_IN_PROJECT: { message: 'Ticket não pertence ao projeto selecionado.', code: 'TIME_ENTRY_TICKET_NOT_IN_PROJECT' },
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
    throw appError(MSG.START_BEFORE_END, 400);
  }

  const duration = endMin - startMin;
  if (duration < 15) {
    throw appError(MSG.MIN_DURATION, 400);
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
    throw appError(
      { message: `Sobreposição detectada com registro das ${entry.startTime} às ${entry.endTime}.`, code: MSG.OVERLAP.code },
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
      subphaseId: timeEntries.subphaseId,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
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
  userRole?: string;
  id?: string;
  projectId: string;
  date: string;
  startTime: string;
  endTime: string;
  description?: string;
  ticketId?: string | null;
  subphaseId?: string | null;
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
  if (!isOpen) throw appError(MSG.MONTH_CLOSED, 400);

  // 4. Validate project allocation
  const [allocation] = await db
    .select({ id: projectAllocations.id })
    .from(projectAllocations)
    .where(and(
      eq(projectAllocations.projectId, data.projectId),
      eq(projectAllocations.userId, data.userId),
    ))
    .limit(1);

  if (!allocation) throw appError(MSG.NOT_ALLOCATED, 400);

  // 5. Validate ticket belongs to project (if provided)
  if (data.ticketId) {
    const [ticket] = await db
      .select({ projectId: tickets.projectId })
      .from(tickets)
      .where(eq(tickets.id, data.ticketId))
      .limit(1);
    if (!ticket) throw appError(MSG.TICKET_NOT_FOUND, 404);
    if (ticket.projectId !== data.projectId) {
      throw appError(MSG.TICKET_NOT_IN_PROJECT, 400);
    }
  }

  // 5.5 Validate subphase (obrigatório para novos apontamentos)
  if (!data.id && !data.subphaseId) {
    throw appError(MSG.SUBPHASE_REQUIRED, 400);
  }

  if (data.subphaseId) {
    const [subphase] = await db.select({ id: projectSubphases.id, status: projectSubphases.status })
      .from(projectSubphases).where(eq(projectSubphases.id, data.subphaseId)).limit(1);
    if (!subphase) throw appError(MSG.SUBPHASE_NOT_FOUND, 404);
    if (subphase.status !== 'in_progress') throw appError(MSG.SUBPHASE_NOT_IN_PROGRESS, 400);

    if (data.userRole === 'gestor' || data.userRole === 'super_admin') {
      // Validar que a subfase pertence ao projeto
      const [spInProject] = await db.select({ id: projectSubphases.id })
        .from(projectSubphases)
        .innerJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
        .where(and(
          eq(projectSubphases.id, data.subphaseId),
          eq(projectPhases.projectId, data.projectId),
        ))
        .limit(1);
      if (!spInProject) throw appError(MSG.SUBPHASE_NOT_IN_PROJECT, 400);
    } else {
      // consultor: check subphase_consultants
      const [link] = await db.select({ id: subphaseConsultants.id })
        .from(subphaseConsultants)
        .where(and(eq(subphaseConsultants.subphaseId, data.subphaseId), eq(subphaseConsultants.userId, data.userId)))
        .limit(1);
      if (!link) throw appError(MSG.NOT_LINKED_TO_SUBPHASE, 400);
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

    if (!existing) throw appError(MSG.NOT_FOUND, 404);
    if (existing.userId !== data.userId) throw appError(MSG.NOT_OWNER, 403);

    // 8. Validate overlap (excluding self)
    await validateOverlap(data.userId, data.date, startTime, endTime, data.id);

    // 9. Update
    const [updated] = await db.update(timeEntries).set({
      projectId: data.projectId,
      date: data.date,
      startTime,
      endTime,
      hours,
      description: data.description ?? null,
      ticketId: data.ticketId ?? null,
      subphaseId: data.subphaseId ?? null,
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
    date: data.date,
    startTime,
    endTime,
    hours,
    description: data.description ?? null,
    ticketId: data.ticketId ?? null,
    subphaseId: data.subphaseId ?? null,
  }).returning();

  return created;
}

export async function deleteTimeEntry(id: string, userId: string) {
  const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  if (!entry) throw appError(MSG.NOT_FOUND, 404);
  if (entry.userId !== userId) throw appError(MSG.NOT_OWNER, 403);

  // Validate month is open
  const { year, month } = extractYearMonth(entry.date);
  const isOpen = await monthlyTimesheetService.isMonthOpen(userId, year, month);
  if (!isOpen) throw appError(MSG.MONTH_CLOSED, 400);

  await db.delete(timeEntries).where(eq(timeEntries.id, id));
}

export async function listSubphaseTimeEntries(
  subphaseId: string,
  params: PaginationParams & { userId?: string; from?: string; to?: string },
) {
  const { page, limit, userId, from, to } = params;
  const offset = (page - 1) * limit;

  const conditions = [eq(timeEntries.subphaseId, subphaseId)];
  if (userId) conditions.push(eq(timeEntries.userId, userId));
  if (from && to) conditions.push(between(timeEntries.date, from, to));
  else if (from) conditions.push(sql`${timeEntries.date} >= ${from}`);
  else if (to) conditions.push(sql`${timeEntries.date} <= ${to}`);

  const where = and(...conditions);

  const [data, [{ total }], [summary]] = await Promise.all([
    db.select({
      id: timeEntries.id,
      date: timeEntries.date,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      hours: timeEntries.hours,
      userName: users.name,
      description: timeEntries.description,
    })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(where)
      .orderBy(desc(timeEntries.date), asc(timeEntries.startTime))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(timeEntries).where(where),
    db.select({
      actualHours: sql<string>`coalesce(sum(${timeEntries.hours}), 0)`,
    }).from(timeEntries).where(and(eq(timeEntries.subphaseId, subphaseId))),
  ]);

  // Get estimated hours from subphase
  const [subphase] = await db.select({ estimatedHours: projectSubphases.estimatedHours })
    .from(projectSubphases).where(eq(projectSubphases.id, subphaseId)).limit(1);

  const estimatedHours = Number(subphase?.estimatedHours ?? 0);
  const actualHours = Number(summary.actualHours);

  return {
    summary: {
      estimatedHours,
      actualHours,
      percentComplete: estimatedHours > 0 ? Math.round((actualHours / estimatedHours) * 100) : 0,
    },
    data,
    meta: buildMeta(total, { page, limit }),
  };
}

export async function listPhaseTimeEntries(
  phaseId: string,
  params: PaginationParams & { userId?: string; subphaseId?: string; from?: string; to?: string },
) {
  const { page, limit, userId, subphaseId, from, to } = params;
  const offset = (page - 1) * limit;

  // Get all subphase IDs for this phase
  const phaseSubphases = await db.select({ id: projectSubphases.id, estimatedHours: projectSubphases.estimatedHours })
    .from(projectSubphases)
    .where(and(eq(projectSubphases.phaseId, phaseId), eq(projectSubphases.isActive, true)));

  const subphaseIds = phaseSubphases.map(s => s.id);
  if (subphaseIds.length === 0) {
    return {
      summary: { estimatedHours: 0, actualHours: 0, percentComplete: 0 },
      data: [],
      meta: buildMeta(0, { page, limit }),
    };
  }

  const conditions = [sql`${timeEntries.subphaseId} in ${subphaseIds}`];
  if (userId) conditions.push(eq(timeEntries.userId, userId));
  if (subphaseId) conditions.push(eq(timeEntries.subphaseId, subphaseId));
  if (from && to) conditions.push(between(timeEntries.date, from, to));
  else if (from) conditions.push(sql`${timeEntries.date} >= ${from}`);
  else if (to) conditions.push(sql`${timeEntries.date} <= ${to}`);

  const where = and(...conditions);

  const [data, [{ total }], [summary]] = await Promise.all([
    db.select({
      id: timeEntries.id,
      date: timeEntries.date,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      hours: timeEntries.hours,
      userName: users.name,
      description: timeEntries.description,
      subphaseName: projectSubphases.name,
    })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(projectSubphases, eq(timeEntries.subphaseId, projectSubphases.id))
      .where(where)
      .orderBy(desc(timeEntries.date), asc(timeEntries.startTime))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(timeEntries).where(where),
    db.select({
      actualHours: sql<string>`coalesce(sum(${timeEntries.hours}), 0)`,
    }).from(timeEntries).where(and(sql`${timeEntries.subphaseId} in ${subphaseIds}`)),
  ]);

  const estimatedHours = phaseSubphases.reduce((sum, s) => sum + Number(s.estimatedHours ?? 0), 0);
  const actualHours = Number(summary.actualHours);

  return {
    summary: {
      estimatedHours,
      actualHours,
      percentComplete: estimatedHours > 0 ? Math.round((actualHours / estimatedHours) * 100) : 0,
    },
    data,
    meta: buildMeta(total, { page, limit }),
  };
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
        date: timeEntries.date,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        hours: timeEntries.hours,
        description: timeEntries.description,
        createdAt: timeEntries.createdAt,
        ticketId: timeEntries.ticketId,
        ticketCode: tickets.code,
        ticketTitle: tickets.title,
        subphaseId: timeEntries.subphaseId,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
      .where(where)
      .orderBy(desc(timeEntries.date), asc(timeEntries.startTime))
      .limit(limit)
      .offset(offset),
    db.select({ total: drizzleCount() }).from(timeEntries).where(where),
  ]);

  return { data, meta: buildMeta(total, { page, limit }) };
}

// --- List view for consolidated timesheet page ---

interface ListViewParams {
  month: string;
  consultantId?: string;
  projectId?: string;
  subphaseId?: string;
  ticketId?: string;
  all?: boolean;
}

async function getGestorProjectIds(userId: string): Promise<string[]> {
  const rows = await db.select({ projectId: projectAllocations.projectId })
    .from(projectAllocations)
    .where(eq(projectAllocations.userId, userId));
  return rows.map(r => r.projectId);
}

export async function listForView(params: ListViewParams, userId: string, userRole: string) {
  const { month, consultantId, projectId, subphaseId, ticketId, all } = params;
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const monthNum = parseInt(monthStr) - 1;
  const firstDay = new Date(year, monthNum, 1);
  const lastDay = new Date(year, monthNum + 1, 0);
  const startDate = firstDay.toISOString().split('T')[0];
  const endDate = lastDay.toISOString().split('T')[0];

  const conditions = [
    gte(timeEntries.date, startDate),
    lte(timeEntries.date, endDate),
  ];

  // Scope by role
  if (userRole === 'consultor') {
    conditions.push(eq(timeEntries.userId, userId));
  } else if (userRole === 'gestor') {
    const gestorProjectIds = await getGestorProjectIds(userId);
    if (gestorProjectIds.length === 0) {
      return { entries: [], totalHours: '0.00' };
    }
    conditions.push(inArray(timeEntries.projectId, gestorProjectIds));
    if (consultantId && !all) {
      conditions.push(eq(timeEntries.userId, consultantId));
    } else if (!all) {
      conditions.push(eq(timeEntries.userId, userId));
    }
  } else if (userRole === 'super_admin') {
    if (consultantId && !all) {
      conditions.push(eq(timeEntries.userId, consultantId));
    } else if (!all) {
      conditions.push(eq(timeEntries.userId, userId));
    }
  }

  // Optional filters
  if (projectId) conditions.push(eq(timeEntries.projectId, projectId));
  if (subphaseId) conditions.push(eq(timeEntries.subphaseId, subphaseId));
  if (ticketId) conditions.push(eq(timeEntries.ticketId, ticketId));

  const entries = await db.select({
    id: timeEntries.id,
    date: timeEntries.date,
    startTime: timeEntries.startTime,
    endTime: timeEntries.endTime,
    hours: timeEntries.hours,
    description: timeEntries.description,
    consultantId: users.id,
    consultantName: users.name,
    projectId: projects.id,
    projectName: projects.name,
    subphaseId: projectSubphases.id,
    subphaseName: projectSubphases.name,
    phaseName: projectPhases.name,
    ticketId: tickets.id,
    ticketCode: tickets.code,
    ticketTitle: tickets.title,
  })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(projectSubphases, eq(timeEntries.subphaseId, projectSubphases.id))
    .leftJoin(projectPhases, eq(projectSubphases.phaseId, projectPhases.id))
    .leftJoin(tickets, eq(timeEntries.ticketId, tickets.id))
    .where(and(...conditions))
    .orderBy(asc(timeEntries.date), asc(timeEntries.startTime));

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0).toFixed(2);

  return { entries, totalHours };
}
