import { eq, and, between, sql, sum, count as drizzleCount } from 'drizzle-orm';
import { db } from '../db';
import { timeEntries, projects, clients, users, consultantProfiles } from '../db/schema';

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

export async function getManagerDashboard() {
  const now = new Date();
  const { from: monthFrom, to: monthTo } = getMonthRange(now);

  // Total hours this month (all statuses except draft)
  const [totalMonth] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      sql`${timeEntries.status} != 'draft'`,
    ));

  // Hours approved this month
  const [approvedMonth] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      eq(timeEntries.status, 'approved'),
    ));

  // Hours pending this month
  const [pendingMonth] = await db
    .select({ total: sum(timeEntries.hours) })
    .from(timeEntries)
    .where(and(
      between(timeEntries.date, monthFrom, monthTo),
      eq(timeEntries.status, 'submitted'),
    ));

  // Pending approval count (all time)
  const [pendingCount] = await db
    .select({ total: drizzleCount() })
    .from(timeEntries)
    .where(eq(timeEntries.status, 'submitted'));

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
      eq(timeEntries.status, 'approved'),
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
      eq(timeEntries.status, 'approved'),
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
      eq(timeEntries.status, 'approved'),
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
      eq(timeEntries.status, 'approved'),
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
    totalHoursThisMonth: Number(totalMonth.total) || 0,
    totalHoursApproved: Number(approvedMonth.total) || 0,
    totalHoursPending: Number(pendingMonth.total) || 0,
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

  // Status breakdown (this month)
  const statusBreakdown = await db
    .select({
      status: timeEntries.status,
      hours: sum(timeEntries.hours),
    })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.userId, userId),
      between(timeEntries.date, monthFrom, monthTo),
    ))
    .groupBy(timeEntries.status);

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
    statusBreakdown: statusBreakdown.map((r) => ({
      status: r.status,
      hours: Number(r.hours) || 0,
    })),
    monthlyHistory: monthlyHistory.map((r) => ({
      month: r.month,
      hours: Number(r.hours) || 0,
    })),
  };
}
