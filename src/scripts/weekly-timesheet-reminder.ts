import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db';
import { projectAllocations, projects, timeEntries, users } from '../db/schema';
import { getEmailProvider } from '../providers/email';
import { buildWeeklyTimesheetReminderEmail } from '../emails';
import { addDays, todayInBrazil } from '../utils/brazil-date';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export function computeWeekRange(today: string): { weekStart: string; weekEnd: string } {
  const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=Dom ... 6=Sab
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentWeekMonday = addDays(today, -daysSinceMonday);
  const weekStart = addDays(currentWeekMonday, -7);
  const weekEnd = addDays(weekStart, 6);
  return { weekStart, weekEnd };
}

export function formatBr(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

interface AllocationRow {
  userId: string;
  name: string;
  email: string;
  projectName: string;
}

export interface Recipient {
  userId: string;
  name: string;
  email: string;
  projects: string[];
}

export function groupByUser(rows: AllocationRow[]): Recipient[] {
  const byUser = new Map<string, Recipient>();
  for (const row of rows) {
    const existing = byUser.get(row.userId);
    if (existing) {
      if (!existing.projects.includes(row.projectName)) existing.projects.push(row.projectName);
    } else {
      byUser.set(row.userId, { userId: row.userId, name: row.name, email: row.email, projects: [row.projectName] });
    }
  }
  return Array.from(byUser.values());
}

export function filterPendingRecipients(recipients: Recipient[], userIdsWithEntries: Set<string>): Recipient[] {
  return recipients.filter((r) => !userIdsWithEntries.has(r.userId));
}

async function main() {
  const { weekStart, weekEnd } = computeWeekRange(todayInBrazil());

  const allocationRows = await db
    .select({ userId: users.id, name: users.name, email: users.email, projectName: projects.name })
    .from(projectAllocations)
    .innerJoin(projects, and(
      eq(projects.id, projectAllocations.projectId),
      eq(projects.status, 'active'),
    ))
    .innerJoin(users, and(
      eq(users.id, projectAllocations.userId),
      eq(users.isActive, true),
      inArray(users.role, ['consultor', 'gestor']),
    ));

  const recipients = groupByUser(allocationRows);

  const entriesLastWeek = await db
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(and(gte(timeEntries.date, weekStart), lte(timeEntries.date, weekEnd)));

  const usersWithEntries = new Set(entriesLastWeek.map((e) => e.userId));
  const pending = filterPendingRecipients(recipients, usersWithEntries);

  const timesheetUrl = `${env.FRONTEND_URL}/timesheet`;

  let sent = 0;
  let failed = 0;
  for (const recipient of pending) {
    try {
      const email = buildWeeklyTimesheetReminderEmail({
        name: recipient.name,
        weekStart: formatBr(weekStart),
        weekEnd: formatBr(weekEnd),
        projectNames: recipient.projects,
        timesheetUrl,
      });
      await getEmailProvider().send({
        to: recipient.email, subject: email.subject, html: email.html, text: email.text,
      });
      sent++;
    } catch (err) {
      failed++;
      logger.error({ err, email: recipient.email }, 'Falha ao enviar lembrete de apontamento');
    }
  }

  logger.info({ sent, failed, total: pending.length }, 'Lembrete semanal de apontamento concluído');

  if (failed > 0 && failed === pending.length && pending.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ err }, 'Falha ao rodar lembrete semanal de apontamento');
    process.exit(1);
  });
}
