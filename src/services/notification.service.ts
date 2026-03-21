import { eq, and, between, sql, notInArray } from 'drizzle-orm';
import { db } from '../db';
import { users, timeEntries, consultantProfiles, projects, clients } from '../db/schema';
import { getEmailProvider } from '../providers/email';
import { getSettingsMap } from './platform-settings.service';
import { buildDailyReminderEmail } from '../emails/daily-reminder';
import { buildWeeklyReminderEmail } from '../emails/weekly-reminder';
import { buildEntryRejectedEmail } from '../emails/entry-rejected';
import { buildWeekApprovedEmail } from '../emails/week-approved';
import { buildOverdueWeekEmail } from '../emails/overdue-week';
import { env } from '../config/env';
import { logger } from '../utils/logger';

function getTimesheetUrl(): string {
  return `${env.FRONTEND_URL}/timesheet`;
}

function getWeekEndDate(weekStartDate: string): string {
  const start = new Date(weekStartDate);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return end.toISOString().split('T')[0];
}

function getStartOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function formatDateBR(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

async function getAppName(): Promise<string> {
  const settings = await getSettingsMap();
  return settings['app_name'] || 'Template Base';
}

export async function notifyEntryRejected(entryId: string, comment: string, rejectedBy: string) {
  try {
    // Get entry details with project and user info
    const [entry] = await db
      .select({
        date: timeEntries.date,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        hours: timeEntries.hours,
        userId: timeEntries.userId,
        userName: users.name,
        userEmail: users.email,
        projectName: projects.name,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(eq(timeEntries.id, entryId))
      .limit(1);

    if (!entry) return;

    // Get reviewer name
    const [reviewer] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, rejectedBy))
      .limit(1);

    const appName = await getAppName();
    const timeRange = `${entry.startTime.slice(0, 5)}-${entry.endTime.slice(0, 5)}`;

    const emailData = buildEntryRejectedEmail({
      userName: entry.userName,
      date: `${formatDateBR(entry.date)} (${timeRange})`,
      projectName: entry.projectName || 'Sem projeto',
      hours: Number(entry.hours),
      comment,
      reviewerName: reviewer?.name || 'Gestor',
      appName,
      timesheetUrl: getTimesheetUrl(),
    });

    const emailProvider = getEmailProvider();
    await emailProvider.send({
      to: entry.userEmail,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
    });

    logger.info({ entryId, userId: entry.userId }, 'Entry rejected notification sent');
  } catch (err) {
    logger.error({ err, entryId }, 'Failed to send entry rejected notification');
  }
}

export async function notifyWeekApproved(entryIds: string[], approvedBy: string) {
  try {
    // Get approved entries grouped by user
    const entries = await db
      .select({
        userId: timeEntries.userId,
        userName: users.name,
        userEmail: users.email,
        date: timeEntries.date,
        hours: timeEntries.hours,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(
        sql`${timeEntries.id} IN ${entryIds}`,
      );

    if (entries.length === 0) return;

    // Group by user
    const byUser = new Map<string, { userName: string; userEmail: string; dates: string[]; totalHours: number; count: number }>();
    for (const entry of entries) {
      const existing = byUser.get(entry.userId);
      if (existing) {
        existing.dates.push(entry.date);
        existing.totalHours += Number(entry.hours);
        existing.count += 1;
      } else {
        byUser.set(entry.userId, {
          userName: entry.userName,
          userEmail: entry.userEmail,
          dates: [entry.date],
          totalHours: Number(entry.hours),
          count: 1,
        });
      }
    }

    const appName = await getAppName();
    const emailProvider = getEmailProvider();

    for (const [userId, data] of byUser) {
      const sortedDates = data.dates.sort();
      const weekStart = formatDateBR(sortedDates[0]);
      const weekEnd = formatDateBR(sortedDates[sortedDates.length - 1]);

      const emailData = buildWeekApprovedEmail({
        userName: data.userName,
        weekStart,
        weekEnd,
        totalHours: data.totalHours,
        approvedCount: data.count,
        appName,
      });

      await emailProvider.send({
        to: data.userEmail,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
      });

      logger.info({ userId, approvedCount: data.count }, 'Week approved notification sent');
    }
  } catch (err) {
    logger.error({ err, entryIds }, 'Failed to send week approved notifications');
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

export async function sendWeeklyReminders() {
  const today = new Date();
  const weekStart = getStartOfWeek(today);
  const weekEnd = getWeekEndDate(weekStart);

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
      // Get draft entries for this week (not yet submitted)
      const draftEntries = await db
        .select({ hours: timeEntries.hours })
        .from(timeEntries)
        .where(and(
          eq(timeEntries.userId, consultant.userId),
          between(timeEntries.date, weekStart, weekEnd),
          eq(timeEntries.status, 'draft'),
        ));

      // Skip if no draft entries (either already submitted or empty)
      if (draftEntries.length === 0) continue;

      const totalHours = draftEntries.reduce((sum, e) => sum + Number(e.hours), 0);

      const emailData = buildWeeklyReminderEmail({
        userName: consultant.userName,
        weekStart: formatDateBR(weekStart),
        weekEnd: formatDateBR(weekEnd),
        totalHours,
        targetHours: 40,
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
      logger.error({ err, userId: consultant.userId }, 'Failed to send weekly reminder');
    }
  }

  logger.info({ sent, total: consultants.length }, 'Weekly reminders sent');
  return { sent, total: consultants.length };
}

export async function sendOverdueReminders() {
  const today = new Date();
  // Get previous week's start date
  const prevWeekDate = new Date(today);
  prevWeekDate.setDate(prevWeekDate.getDate() - 7);
  const prevWeekStart = getStartOfWeek(prevWeekDate);
  const prevWeekEnd = getWeekEndDate(prevWeekStart);

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
      // Check for draft entries in previous week (not submitted)
      const draftEntries = await db
        .select({ hours: timeEntries.hours })
        .from(timeEntries)
        .where(and(
          eq(timeEntries.userId, consultant.userId),
          between(timeEntries.date, prevWeekStart, prevWeekEnd),
          eq(timeEntries.status, 'draft'),
        ));

      // Skip if no overdue entries
      if (draftEntries.length === 0) continue;

      const totalHours = draftEntries.reduce((sum, e) => sum + Number(e.hours), 0);

      const emailData = buildOverdueWeekEmail({
        userName: consultant.userName,
        weekStart: formatDateBR(prevWeekStart),
        weekEnd: formatDateBR(prevWeekEnd),
        totalHours,
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
      logger.error({ err, userId: consultant.userId }, 'Failed to send overdue reminder');
    }
  }

  logger.info({ sent, total: consultants.length }, 'Overdue reminders sent');
  return { sent, total: consultants.length };
}
