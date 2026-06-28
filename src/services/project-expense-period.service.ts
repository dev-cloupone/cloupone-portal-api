import { eq, and, between, asc, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { projectExpensePeriods, expenses } from '../db/schema';
import { appError } from '../utils/app-error';

const MSG = {
  NOT_FOUND: { message: 'Período não encontrado.', code: 'EXPENSE_PERIOD_NOT_FOUND' },
  NOT_OPEN: { message: 'Período não está aberto.', code: 'EXPENSE_PERIOD_NOT_OPEN' },
  NOT_CLOSED: { message: 'Período não está fechado.', code: 'EXPENSE_PERIOD_NOT_CLOSED' },
  ALREADY_EXISTS: { message: 'Já existe um período para esta semana neste projeto.', code: 'EXPENSE_PERIOD_ALREADY_EXISTS' },
  NOT_SUNDAY: { message: 'A data de início deve ser um domingo.', code: 'EXPENSE_PERIOD_NOT_SUNDAY' },
  CUSTOM_DAY_OUT_OF_RANGE: { message: 'Um ou mais dias customizados estão fora do intervalo da semana.', code: 'EXPENSE_PERIOD_CUSTOM_DAY_OUT_OF_RANGE' },
  HAS_PENDING: { message: 'Existem despesas pendentes de aprovação neste período. Resolva antes de fechar.', code: 'EXPENSE_PERIOD_HAS_PENDING' },
  EXPENSES_ON_REMOVED_DAYS: { message: 'Existem despesas lançadas em dias que seriam removidos. Exclua as despesas antes de remover esses dias.', code: 'EXPENSE_PERIOD_EXPENSES_ON_REMOVED_DAYS' },
} as const;

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + 'T12:00:00');
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

function isSunday(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00Z').getDay() === 0;
}

function getWeekDays(weekStart: string): string[] {
  const days: string[] = [];
  const start = new Date(weekStart + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
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
    throw appError(MSG.NOT_SUNDAY, 400);
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
  if (existing) throw appError(MSG.ALREADY_EXISTS, 409);

  // Validate customDays within range
  if (data.customDays?.length) {
    for (const day of data.customDays) {
      if (day < data.weekStart || day > weekEnd) {
        throw appError(MSG.CUSTOM_DAY_OUT_OF_RANGE, 400);
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

  if (!period) throw appError(MSG.NOT_FOUND, 404);
  if (period.projectId !== projectId) throw appError(MSG.NOT_FOUND, 404);
  if (period.status !== 'open') throw appError(MSG.NOT_OPEN, 400);

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
    throw appError(MSG.HAS_PENDING, 400);
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

  if (!period) throw appError(MSG.NOT_FOUND, 404);
  if (period.projectId !== projectId) throw appError(MSG.NOT_FOUND, 404);
  if (period.status !== 'closed') throw appError(MSG.NOT_CLOSED, 400);

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

export async function updatePeriodDays(
  periodId: string,
  projectId: string,
  data: { customDays: string[] | null },
  updatedBy: string,
) {
  const [period] = await db.select()
    .from(projectExpensePeriods)
    .where(eq(projectExpensePeriods.id, periodId))
    .limit(1);

  if (!period) throw appError(MSG.NOT_FOUND, 404);
  if (period.projectId !== projectId) throw appError(MSG.NOT_FOUND, 404);
  if (period.status !== 'open') throw appError(MSG.NOT_OPEN, 400);

  const weekDays = getWeekDays(period.weekStart);
  const weekDaysSet = new Set(weekDays);

  // Deduplicate
  let normalizedDays = data.customDays ? [...new Set(data.customDays)] : null;

  // Normalize: if all 7 days or empty, save as null (full week)
  if (normalizedDays && (normalizedDays.length === 0 || normalizedDays.length === 7)) {
    normalizedDays = null;
  }

  // Validate customDays belong to this week
  if (normalizedDays?.length) {
    for (const day of normalizedDays) {
      if (!weekDaysSet.has(day)) {
        throw appError(MSG.CUSTOM_DAY_OUT_OF_RANGE, 400);
      }
    }
  }

  // Determine which days are being removed
  const previousDays = period.customDays && Array.isArray(period.customDays)
    ? (period.customDays as string[])
    : weekDays;
  const newDays = normalizedDays || weekDays;
  const newDaysSet = new Set(newDays);
  const removedDays = previousDays.filter(d => !newDaysSet.has(d));

  // Check for existing expenses on removed days
  if (removedDays.length > 0) {
    const [expenseCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(and(
        eq(expenses.projectId, period.projectId),
        inArray(expenses.date, removedDays),
      ));

    if (expenseCount && expenseCount.count > 0) {
      throw appError(MSG.EXPENSES_ON_REMOVED_DAYS, 400);
    }
  }

  const [updated] = await db.update(projectExpensePeriods)
    .set({
      customDays: normalizedDays,
      daysEditedBy: updatedBy,
      daysEditedAt: new Date(),
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
