import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { projectAllocations, projects } from '../db/schema';
import { AppError } from './app-error';

const MSG = {
  NO_ACCESS: 'Você não tem acesso a este projeto.',
} as const;

/**
 * Valida acesso do usuário ao projeto.
 * - super_admin: acesso irrestrito
 * - gestor: precisa de registro em project_allocations
 * - consultor: precisa de registro em project_allocations
 * - client: precisa que o projeto pertença ao seu client
 */
export async function assertUserHasProjectAccess(
  userId: string,
  userRole: string,
  projectId: string,
  userClientId?: string | null,
): Promise<void> {
  if (userRole === 'super_admin') return;

  if (userRole === 'gestor' || userRole === 'consultor') {
    const [allocation] = await db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(and(
        eq(projectAllocations.projectId, projectId),
        eq(projectAllocations.userId, userId),
      ))
      .limit(1);
    if (!allocation) throw new AppError(MSG.NO_ACCESS, 403);
    return;
  }

  // role 'client' — verifica clientId
  if (!userClientId) throw new AppError(MSG.NO_ACCESS, 403);
  const [project] = await db
    .select({ clientId: projects.clientId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project || project.clientId !== userClientId) throw new AppError(MSG.NO_ACCESS, 403);
}
