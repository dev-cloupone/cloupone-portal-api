import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { reports, reportPermissions, users } from '../db/schema';
import { AppError } from '../utils/app-error';

const MSG = {
  REPORT_NOT_FOUND: 'Relatório não encontrado.',
  REPORT_INACTIVE: 'Relatório inativo.',
  ACCESS_DENIED: 'Você não tem acesso a este relatório.',
} as const;

/** Lista relatórios visíveis ao usuário */
export async function listReports(userId: string, userRole: string) {
  const allReports = await db.select().from(reports).where(eq(reports.isActive, true));

  if (userRole === 'super_admin') return allReports;

  const permissions = await db
    .select({ reportId: reportPermissions.reportId })
    .from(reportPermissions)
    .where(eq(reportPermissions.userId, userId));

  const allowedIds = new Set(permissions.map((p) => p.reportId));
  return allReports.filter((r) => allowedIds.has(r.id));
}

/** Busca relatório por slug com verificação de acesso */
export async function getReportBySlug(slug: string, userId: string, userRole: string) {
  const report = await db.query.reports.findFirst({
    where: eq(reports.slug, slug),
  });

  if (!report) throw new AppError(MSG.REPORT_NOT_FOUND, 404);
  if (!report.isActive) throw new AppError(MSG.REPORT_INACTIVE, 404);

  if (userRole !== 'super_admin') {
    const perm = await db.query.reportPermissions.findFirst({
      where: and(
        eq(reportPermissions.reportId, report.id),
        eq(reportPermissions.userId, userId),
      ),
    });
    if (!perm) throw new AppError(MSG.ACCESS_DENIED, 403);
  }

  return report;
}

/** Lista gestores com status de acesso a um relatório */
export async function listPermissions(reportId: string) {
  const gestores = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.role, 'gestor'), eq(users.isActive, true)));

  const perms = await db
    .select({ userId: reportPermissions.userId })
    .from(reportPermissions)
    .where(eq(reportPermissions.reportId, reportId));

  const permSet = new Set(perms.map((p) => p.userId));

  return gestores.map((g) => ({
    ...g,
    hasAccess: permSet.has(g.id),
  }));
}

/** Atualiza permissões (replace) */
export async function updatePermissions(reportId: string, userIds: string[], grantedBy: string) {
  const report = await db.query.reports.findFirst({
    where: eq(reports.id, reportId),
  });
  if (!report) throw new AppError(MSG.REPORT_NOT_FOUND, 404);

  await db.transaction(async (tx) => {
    await tx.delete(reportPermissions).where(eq(reportPermissions.reportId, reportId));

    if (userIds.length > 0) {
      await tx.insert(reportPermissions).values(
        userIds.map((userId) => ({ reportId, userId, grantedBy })),
      );
    }
  });
}
