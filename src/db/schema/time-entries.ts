import { pgTable, uuid, date, decimal, text, timestamp, index, time } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { tickets } from './tickets';
import { projectSubphases } from './project-subphases';

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  date: date('date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  hours: decimal('hours', { precision: 4, scale: 2 }).notNull(),
  description: text('description'),
  ticketId: uuid('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
  subphaseId: uuid('subphase_id').references(() => projectSubphases.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('time_entries_user_date_idx').on(table.userId, table.date),
  index('time_entries_project_idx').on(table.projectId),
  index('time_entries_overlap_idx').on(table.userId, table.date, table.startTime, table.endTime),
]);
