import { eq, and, between, sql } from 'drizzle-orm';
import { db } from '../db';
import { users, timeEntries, consultantProfiles, monthlyTimesheets } from '../db/schema';
import { getEmailProvider } from '../providers/email';
import { getSettingsMap } from './platform-settings.service';
import { buildDailyReminderEmail } from '../emails/daily-reminder';
import { buildMonthApprovedEmail } from '../emails/month-approved';
import { buildMonthReopenedEmail } from '../emails/month-reopened';
import { buildMonthEscalationEmail } from '../emails/month-escalation';
import { env } from '../config/env';
import { logger } from '../utils/logger';

function getTimesheetUrl(): string {
  return `${env.FRONTEND_URL}/timesheet`;
}

function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function formatMonthYear(month: number, year: number): string {
  return `${MONTH_NAMES[month - 1]}/${year}`;
}

async function getAppName(): Promise<string> {
  const settings = await getSettingsMap();
  return settings['app_name'] || 'Template Base';
}

export async function notifyMonthApproved(userId: string, year: number, month: number) {
  try {
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return;

    // Get total hours for this month
    const firstDay = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const lastDay = new Date(year, month, 0).toISOString().split('T')[0];

    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)` })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.userId, userId),
        between(timeEntries.date, firstDay, lastDay),
      ));

    const totalHours = Number(result?.total) || 0;
    const appName = await getAppName();
    const monthYear = formatMonthYear(month, year);

    const emailData = buildMonthApprovedEmail({
      userName: user.name,
      monthYear,
      totalHours,
      appName,
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    logger.info({ userId, year, month }, 'Month approved notification sent');
  } catch (err) {
    logger.error({ err, userId, year, month }, 'Failed to send month approved notification');
  }
}

export async function notifyMonthReopened(userId: string, year: number, month: number, reason: string) {
  try {
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return;

    const appName = await getAppName();
    const monthYear = formatMonthYear(month, year);

    const emailData = buildMonthReopenedEmail({
      userName: user.name,
      monthYear,
      reason,
      appName,
      timesheetUrl: getTimesheetUrl(),
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: user.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    logger.info({ userId, year, month }, 'Month reopened notification sent');
  } catch (err) {
    logger.error({ err, userId, year, month }, 'Failed to send month reopened notification');
  }
}

export async function notifyEscalation(userId: string, year: number, month: number, gestorId: string) {
  try {
    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const [gestor] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, gestorId))
      .limit(1);

    if (!user || !gestor) return;

    const appName = await getAppName();
    const monthYear = formatMonthYear(month, year);

    const emailData = buildMonthEscalationEmail({
      gestorName: gestor.name,
      consultantName: user.name,
      monthYear,
      appName,
      timesheetUrl: getTimesheetUrl(),
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: gestor.email,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    logger.info({ userId, gestorId, year, month }, 'Escalation notification sent');
  } catch (err) {
    logger.error({ err, userId, year, month }, 'Failed to send escalation notification');
  }
}

export async function sendDailyReminders() {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().getDay();

  // Skip weekends
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { sent: 0, skipped: 'weekend' };
  }

  // Find all active consultants
  const consultants = await db
    .select({
      userId: consultantProfiles.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(consultantProfiles)
    .innerJoin(users, and(eq(consultantProfiles.userId, users.id), eq(users.isActive, true)));

  // Find consultants who already have entries for today
  const usersWithEntries = await db
    .select({ userId: timeEntries.userId })
    .from(timeEntries)
    .where(eq(timeEntries.date, today))
    .groupBy(timeEntries.userId);

  const usersWithEntriesSet = new Set(usersWithEntries.map(e => e.userId));

  // Filter to only consultants without entries today
  const toNotify = consultants.filter(c => !usersWithEntriesSet.has(c.userId));

  if (toNotify.length === 0) {
    return { sent: 0, message: 'Todos os consultores já apontaram horas hoje.' };
  }

  const appName = await getAppName();
  const emailProvider = getEmailProvider();
  let sent = 0;

  for (const consultant of toNotify) {
    try {
      const emailData = buildDailyReminderEmail({
        userName: consultant.userName,
        date: formatDateBR(today),
        appName,
        timesheetUrl: getTimesheetUrl(),
      });

      await emailProvider.send({
        to: consultant.userEmail,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });

      sent++;
    } catch (err) {
      logger.error({ err, userId: consultant.userId }, 'Failed to send daily reminder');
    }
  }

  logger.info({ sent, total: toNotify.length }, 'Daily reminders sent');
  return { sent, total: toNotify.length };
}

export async function sendMonthlyReminders() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Find all active consultants
  const consultants = await db
    .select({
      userId: consultantProfiles.userId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(consultantProfiles)
    .innerJoin(users, and(eq(consultantProfiles.userId, users.id), eq(users.isActive, true)));

  const appName = await getAppName();
  const emailProvider = getEmailProvider();
  let sent = 0;

  for (const consultant of consultants) {
    try {
      // Check for open/reopened months that are previous to current month
      const pendingMonths = await db
        .select({ year: monthlyTimesheets.year, month: monthlyTimesheets.month })
        .from(monthlyTimesheets)
        .where(and(
          eq(monthlyTimesheets.userId, consultant.userId),
          sql`${monthlyTimesheets.status} IN ('open', 'reopened')`,
          sql`(${monthlyTimesheets.year} < ${currentYear} OR (${monthlyTimesheets.year} = ${currentYear} AND ${monthlyTimesheets.month} < ${currentMonth}))`,
        ));

      if (pendingMonths.length === 0) continue;

      const monthList = pendingMonths.map(m => formatMonthYear(m.month, m.year)).join(', ');

      // Use daily reminder template with custom message about pending months
      const emailData = buildDailyReminderEmail({
        userName: consultant.userName,
        date: monthList,
        appName,
        timesheetUrl: getTimesheetUrl(),
      });

      // Override subject for monthly context
      emailData.subject = `Lembrete: Aprovação pendente para ${monthList}`;
      emailData.text = [
        `Olá, ${consultant.userName}!`,
        '',
        `Você possui meses pendentes de aprovação: ${monthList}.`,
        '',
        `Acesse o sistema para aprovar seus apontamentos: ${getTimesheetUrl()}`,
      ].join('\n');

      await emailProvider.send({
        to: consultant.userEmail,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });

      sent++;
    } catch (err) {
      logger.error({ err, userId: consultant.userId }, 'Failed to send monthly reminder');
    }
  }

  logger.info({ sent, total: consultants.length }, 'Monthly reminders sent');
  return { sent, total: consultants.length };
}
