import { pgTable, uuid, integer, timestamp, text, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

export const monthlyTimesheetStatusEnum = pgEnum('monthly_timesheet_status', ['open', 'approved', 'reopened']);

export const monthlyTimesheets = pgTable('monthly_timesheets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: monthlyTimesheetStatusEnum('status').notNull().default('open'),
  approvedAt: timestamp('approved_at'),
  approvedById: uuid('approved_by_id').references(() => users.id),
  reopenedAt: timestamp('reopened_at'),
  reopenedById: uuid('reopened_by_id').references(() => users.id),
  reopenReason: text('reopen_reason'),
  escalatedAt: timestamp('escalated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('monthly_timesheets_user_year_month_idx').on(table.userId, table.year, table.month),
]);
