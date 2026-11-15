import { eq } from 'drizzle-orm';
import { db } from '../db';
import { projects } from '../db/schema';
import { appError } from '../utils/app-error';
import { todayInBrazil, addDays, toBrDate } from '../utils/brazil-date';

export const MSG = {
  PROJECT_LOCKED: {
    message: 'Projeto bloqueado para apontamentos fora da janela retroativa permitida. Contate o administrador do sistema.',
    code: 'TIME_ENTRY_PROJECT_LOCKED',
  },
  PROJECT_NOT_FOUND: { message: 'Projeto não encontrado.', code: 'PROJECT_NOT_FOUND' },
} as const;

/** Roles que nunca sao barradas pela trava. */
export const LOCK_BYPASS_ROLES: readonly string[] = ['super_admin', 'administrative'];

export async function isProjectLockedForDate(
  projectId: string,
  date: string,
): Promise<{ locked: boolean; reason?: string; earliestAllowed?: string }> {
  const [project] = await db
    .select({ lockDays: projects.timesheetLockDays })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  // 1. Projeto sem prazo -> liberado (fail-open, igual isMonthOpen sem linha)
  if (!project || project.lockDays === null) return { locked: false };

  const earliestAllowed = addDays(todayInBrazil(), -project.lockDays);

  // 2. Dentro da janela retroativa (ou data futura) -> liberado
  if (date >= earliestAllowed) return { locked: false, earliestAllowed };

  // 3. Bloqueado
  return {
    locked: true,
    earliestAllowed,
    reason: `Apontamentos bloqueados para datas anteriores a ${toBrDate(earliestAllowed)}. Contate o administrador do sistema.`,
  };
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
