import { eq, and, isNotNull, ne } from 'drizzle-orm';
import { db } from '../db';
import { projects, projectAllocations } from '../db/schema';
import { appError } from '../utils/app-error';
import { todayInBrazil, lastDayOfMonth, addDays, daysBetween, yearMonthOf } from '../utils/brazil-date';

export const MSG = {
  PROJECT_LOCKED: {
    message: 'Projeto bloqueado para apontamentos deste mês. Contate o administrador do sistema.',
    code: 'TIME_ENTRY_PROJECT_LOCKED',
  },
  PROJECT_NOT_FOUND: { message: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' },
} as const;

/** Roles que nunca sao barradas pela trava. */
export const LOCK_BYPASS_ROLES: readonly string[] = ['super_admin', 'administrative'];

/** Faltando <= N dias, o consultor ve o aviso de prazo proximo. */
export const UPCOMING_DEADLINE_DAYS = 3;

export async function isProjectLockedForDate(
  projectId: string,
  date: string,
): Promise<{ locked: boolean; reason?: string; deadline?: string }> {
  const [project] = await db
    .select({ lockDays: projects.timesheetLockDays })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  // 1. Projeto sem prazo -> liberado (fail-open, igual isMonthOpen sem linha)
  if (!project || project.lockDays === null) return { locked: false };

  const { year, month } = yearMonthOf(date);
  const deadline = addDays(lastDayOfMonth(year, month), project.lockDays);

  // 2. Dentro do prazo -> liberado
  if (todayInBrazil() <= deadline) return { locked: false, deadline };

  // 3. Bloqueado
  return { locked: true, deadline, reason: MSG.PROJECT_LOCKED.message };
}

export async function getLockStatusForUser(userId: string, month: string) {
  const { year, month: m } = yearMonthOf(month + '-01');

  const rows = await db
    .select({
      projectId: projects.id,
      projectName: projects.name,
      lockDays: projects.timesheetLockDays,
    })
    .from(projectAllocations)
    .innerJoin(projects, eq(projectAllocations.projectId, projects.id))
    .where(and(
      eq(projectAllocations.userId, userId),
      isNotNull(projects.timesheetLockDays),
      ne(projects.status, 'finished'),
    ));

  if (rows.length === 0) return { lockedProjects: [], upcomingDeadlines: [] };

  const today = todayInBrazil();
  const monthEnd = lastDayOfMonth(year, m);

  const lockedProjects: Array<{ projectId: string; projectName: string; deadline: string }> = [];
  const upcomingDeadlines: Array<{ projectId: string; projectName: string; deadline: string; daysLeft: number }> = [];

  for (const r of rows) {
    const deadline = addDays(monthEnd, r.lockDays!);
    if (today <= deadline) {
      const daysLeft = daysBetween(today, deadline);
      if (daysLeft <= UPCOMING_DEADLINE_DAYS) {
        upcomingDeadlines.push({ projectId: r.projectId, projectName: r.projectName, deadline, daysLeft });
      }
    } else {
      lockedProjects.push({ projectId: r.projectId, projectName: r.projectName, deadline });
    }
  }

  return { lockedProjects, upcomingDeadlines };
}

export async function getLockConfig(projectId: string) {
  const [project] = await db
    .select({ lockDays: projects.timesheetLockDays })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw appError(MSG.PROJECT_NOT_FOUND, 404);
  return { lockDays: project.lockDays };
}

export async function setLockDays(projectId: string, lockDays: number | null) {
  const [updated] = await db
    .update(projects)
    .set({ timesheetLockDays: lockDays, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning({ lockDays: projects.timesheetLockDays });
  if (!updated) throw appError(MSG.PROJECT_NOT_FOUND, 404);
  return updated;
}
