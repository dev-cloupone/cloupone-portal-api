import { pgTable, uuid, date, decimal, text, timestamp, pgEnum, index, time } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { activityCategories } from './activity-categories';
import { tickets } from './tickets';

export const timeEntryStatusEnum = pgEnum('time_entry_status', ['draft', 'submitted', 'approved', 'rejected']);

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').references(() => activityCategories.id, { onDelete: 'set null' }),
  date: date('date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  hours: decimal('hours', { precision: 4, scale: 2 }).notNull(),
  description: text('description'),
  status: timeEntryStatusEnum('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('time_entries_user_date_idx').on(table.userId, table.date),
  index('time_entries_user_status_idx').on(table.userId, table.status),
  index('time_entries_project_idx').on(table.projectId),
  index('time_entries_overlap_idx').on(table.userId, table.date, table.startTime, table.endTime),
]);
