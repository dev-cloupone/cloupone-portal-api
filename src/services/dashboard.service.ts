import { eq, and, between, sql, sum, count as drizzleCount } from 'drizzle-orm';
import { db } from '../db';
import { timeEntries, projects, clients, users, consultantProfiles, monthlyTimesheets } from '../db/schema';

function getMonthRange(date: Date): { from: string; to: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const from = new Date(year, month, 1).toISOString().split('T')[0];
  const to = new Date(year, month + 1, 0).toISOString().split('T')[0];
  return { from, to };
}

function getWeekRange(date: Date): { from: string; to: string } {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const from = new Date(d.setDate(diff)).toISOString().split('T')[0];
  const to = new Date(new Date(from).setDate(new Date(from).getDate() + 6)).toISOString().split('T')[0];
  return { from, to };
}

// SQL condition for entries in approved months
const approvedMonthCondition = sql`EXISTS (SELECT 1 FROM monthly_timesheets mt WHERE mt.user_id = ${timeEntries.userId} AND mt.year = EXTRACT(YEAR FROM ${timeEntries.date})::integer AND mt.month = EXTRACT(MONTH FROM ${timeEntries.date})::integer AND mt.status = 'approved')`;

export async function getManagerDashboard() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const { from: monthFrom, to: monthTo } = getMonthRange(now);

  // Total hours this month (all entries)
  const [totalMonth] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(between(timeEntries.date, monthFrom, monthTo));

  // Hours approved this month (via monthly_timesheets)
  const [approvedMonth] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      approvedMonthCondition,
    ));

  // Pending approval count (months open/reopened for previous months)
  const [pendingCount] = await db
    .select({ total: drizzleCount() })
    .from(monthlyTimesheets)
    .where(
      and(
        sql`${monthlyTimesheets.status} IN ('open', 'reopened')`,
        sql`(${monthlyTimesheets.year} < ${currentYear} OR (${monthlyTimesheets.year} = ${currentYear} AND ${monthlyTimesheets.month} < ${currentMonth}))`,
      ),
    );

  // Hours pending = total - approved
  const totalHoursApproved = Number(approvedMonth.total) || 0;
  const totalHoursThisMonth = Number(totalMonth.total) || 0;
  const totalHoursPending = totalHoursThisMonth - totalHoursApproved;

  // Hours by project (this month, approved)
  const hoursByProject = await db
    .select({
      projectName: projects.name,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      approvedMonthCondition,
    ))
    .groupBy(projects.name)
    .orderBy(sql`sum(${timeEntries.hours}) DESC`)
    .limit(10);

  // Hours by consultant (this month, approved)
  const hoursByConsultant = await db
    .select({
      consultantName: users.name,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .innerJoin(users, eq(timeEntries.userId, users.id))
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      approvedMonthCondition,
    ))
    .groupBy(users.name)
    .orderBy(sql`sum(${timeEntries.hours}) DESC`)
    .limit(10);

  // Monthly trend (last 6 months, approved)
  const monthlyTrend = await db
    .select({
      month: sql<string>`to_char(${timeEntries.date}::date, 'YYYY-MM')`,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .where(and(
      approvedMonthCondition,
      sql`${timeEntries.date}::date >= (CURRENT_DATE - INTERVAL '6 months')`,
    ))
    .groupBy(sql`to_char(${timeEntries.date}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${timeEntries.date}::date, 'YYYY-MM')`);

  // Budget alerts (projects with > 80% budget consumed)
  const budgetAlerts = await db
    .select({
      projectName: projects.name,
      budgetHours: projects.budgetHours,
      usedHours: sum(timeEntries.hours),
    })
    .from(projects)
    .innerJoin(timeEntries, and(
      eq(timeEntries.projectId, projects.id),
      approvedMonthCondition,
    ))
    .where(and(
      eq(projects.isActive, true),
      sql`${projects.budgetHours} IS NOT NULL AND ${projects.budgetHours} > 0`,
    ))
    .groupBy(projects.id, projects.name, projects.budgetHours);

  const alerts = budgetAlerts
    .map((a) => ({
      projectName: a.projectName,
      usedPercent: Math.round((Number(a.usedHours) / Number(a.budgetHours)) * 100),
    }))
    .filter((a) => a.usedPercent >= 80)
    .sort((a, b) => b.usedPercent - a.usedPercent);

  return {
    totalHoursThisMonth,
    totalHoursApproved,
    totalHoursPending,
    pendingApprovalCount: pendingCount.total,
    hoursByProject: hoursByProject.map((r) => ({
      projectName: r.projectName,
      hours: Number(r.hours) || 0,
    })),
    hoursByConsultant: hoursByConsultant.map((r) => ({
      consultantName: r.consultantName,
      hours: Number(r.hours) || 0,
    })),
    monthlyTrend: monthlyTrend.map((r) => ({
      month: r.month,
      hours: Number(r.hours) || 0,
    })),
    budgetAlerts: alerts,
  };
}

export async function getConsultantDashboard(userId: string) {
  const now = new Date();
  const { from: weekFrom, to: weekTo } = getWeekRange(now);
  const { from: monthFrom, to: monthTo } = getMonthRange(now);

  // Hours this week
  const [weekHours] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, weekFrom, weekTo),
    ));

  // Hours this month
  const [monthHours] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, monthFrom, monthTo),
    ));

  // Project breakdown (this month)
  const projectBreakdown = await db
    .select({
      projectName: projects.name,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .innerJoin(projects, eq(timeEntries.projectId, projects.id))
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, monthFrom, monthTo),
    ))
    .groupBy(projects.name)
    .orderBy(sql`sum(${timeEntries.hours}) DESC`);

  // Monthly history (last 6 months)
  const monthlyHistory = await db
    .select({
      month: sql<string>`to_char(${timeEntries.date}::date, 'YYYY-MM')`,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      sql`${timeEntries.date}::date >= (CURRENT_DATE - INTERVAL '6 months')`,
    ))
    .groupBy(sql`to_char(${timeEntries.date}::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(${timeEntries.date}::date, 'YYYY-MM')`);

  return {
    hoursThisWeek: Number(weekHours.total) || 0,
    hoursThisMonth: Number(monthHours.total) || 0,
    weeklyTarget: 40,
    projectBreakdown: projectBreakdown.map((r) => ({
      projectName: r.projectName,
      hours: Number(r.hours) || 0,
    })),
    monthlyHistory: monthlyHistory.map((r) => ({
      month: r.month,
      hours: Number(r.hours) || 0,
    })),
  };
}
