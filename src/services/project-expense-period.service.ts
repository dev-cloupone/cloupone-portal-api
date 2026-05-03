import { eq, and, between, asc, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projectExpensePeriods, expenses } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: 'Período não encontrado.',
  NOT_OPEN: 'Período não está aberto.',
  NOT_CLOSED: 'Período não está fechado.',
  ALREADY_EXISTS: 'Já existe um período para esta semana neste projeto.',
  NOT_SUNDAY: 'A data de início deve ser um domingo.',
  CUSTOM_DAY_OUT_OF_RANGE: 'Um ou mais dias customizados estão fora do intervalo da semana.',
  HAS_PENDING: 'Existem despesas pendentes de aprovação neste período. Resolva antes de fechar.',
} as const;

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function isSunday(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00Z').getDay() === 0;
}

export async function listByProject(
  projectId: string,
  filters?: { status?: 'open' | 'closed'; year?: number; month?: number },
) {
  const conditions = [eq(projectExpensePeriods.projectId, projectId)];

  if (filters?.status) {
    conditions.push(eq(projectExpensePeriods.status, filters.status));
  }

  if (filters?.year && filters?.month) {
    const startOfMonth = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
    const endDate = new Date(filters.year, filters.month, 0);
    const endOfMonth = `${filters.year}-${String(filters.month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    // Periods that overlap with the month
    conditions.push(
      sql`${projectExpensePeriods.weekStart} <= ${endOfMonth}`,
      sql`${projectExpensePeriods.weekEnd} >= ${startOfMonth}`,
    );
  }

  return db.select()
    .from(projectExpensePeriods)
    .where(and(...conditions))
    .orderBy(desc(projectExpensePeriods.weekStart));
}

export async function openPeriod(
  projectId: string,
  data: { weekStart: string; customDays?: string[] },
  openedBy: string,
) {
  if (!isSunday(data.weekStart)) {
    throw new AppError(MSG.NOT_SUNDAY, 400);
  }

  const weekEnd = getWeekEnd(data.weekStart);

  // Check for duplicate
  const [existing] = await db.select({ id: projectExpensePeriods.id })
    .from(projectExpensePeriods)
    .where(and(
      eq(projectExpensePeriods.projectId, projectId),
      eq(projectExpensePeriods.weekStart, data.weekStart),
    ))
    .limit(1);
  if (existing) throw new AppError(MSG.ALREADY_EXISTS, 409);

  // Validate customDays within range
  if (data.customDays?.length) {
    for (const day of data.customDays) {
      if (day < data.weekStart || day > weekEnd) {
        throw new AppError(MSG.CUSTOM_DAY_OUT_OF_RANGE, 400);
      }
    }
  }

  const [created] = await db.insert(projectExpensePeriods).values({
    projectId,
    weekStart: data.weekStart,
    weekEnd,
    customDays: data.customDays || null,
    status: 'open',
    openedBy,
  }).returning();

  return created;
}

export async function closePeriod(periodId: string, projectId: string, closedBy: string) {
  const [period] = await db.select()
    .from(projectExpensePeriods)
    .where(eq(projectExpensePeriods.id, periodId))
    .limit(1);

  if (!period) throw new AppError(MSG.NOT_FOUND, 404);
  if (period.projectId !== projectId) throw new AppError(MSG.NOT_FOUND, 404);
  if (period.status !== 'open') throw new AppError(MSG.NOT_OPEN, 400);

  // Check for draft expenses in this period
  const [draftCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(and(
      eq(expenses.projectId, period.projectId),
      inArray(expenses.status, ['created', 'draft', 'submitted']),
      between(expenses.date, period.weekStart, period.weekEnd),
    ));

  if (draftCount && draftCount.count > 0) {
    throw new AppError(MSG.HAS_PENDING, 400);
  }

  const [updated] = await db.update(projectExpensePeriods)
    .set({
      status: 'closed',
      closedBy,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectExpensePeriods.id, periodId))
    .returning();

  return updated;
}

export async function reopenPeriod(periodId: string, projectId: string, reopenedBy: string) {
  const [period] = await db.select()
    .from(projectExpensePeriods)
    .where(eq(projectExpensePeriods.id, periodId))
    .limit(1);

  if (!period) throw new AppError(MSG.NOT_FOUND, 404);
  if (period.projectId !== projectId) throw new AppError(MSG.NOT_FOUND, 404);
  if (period.status !== 'closed') throw new AppError(MSG.NOT_CLOSED, 400);

  const [updated] = await db.update(projectExpensePeriods)
    .set({
      status: 'open',
      reopenedBy,
      reopenedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projectExpensePeriods.id, periodId))
    .returning();

  return updated;
}

export async function getPeriodsForDateRange(
  projectId: string,
  startDate: string,
  endDate: string,
) {
  return db.select()
    .from(projectExpensePeriods)
    .where(and(
      eq(projectExpensePeriods.projectId, projectId),
      sql`${projectExpensePeriods.weekStart} <= ${endDate}`,
      sql`${projectExpensePeriods.weekEnd} >= ${startDate}`,
    ))
    .orderBy(asc(projectExpensePeriods.weekStart));
}

export async function isDateInOpenPeriod(
  projectId: string,
  date: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const [period] = await db.select()
    .from(projectExpensePeriods)
    .where(and(
      eq(projectExpensePeriods.projectId, projectId),
      eq(projectExpensePeriods.status, 'open'),
      sql`${projectExpensePeriods.weekStart} <= ${date}`,
      sql`${projectExpensePeriods.weekEnd} >= ${date}`,
    ))
    .limit(1);

  if (!period) {
    return { allowed: false, reason: 'Esta data não está em um período aberto para lançamento de despesas.' };
  }

  if (period.customDays && Array.isArray(period.customDays)) {
    if (!period.customDays.includes(date)) {
      return { allowed: false, reason: 'Este dia não está habilitado para lançamento nesta semana.' };
    }
  }

  return { allowed: true };
}
