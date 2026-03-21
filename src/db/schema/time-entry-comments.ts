import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';
import { timeEntries } from './time-entries';
import { users } from './users';

export const timeEntryComments = pgTable('time_entry_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  timeEntryId: uuid('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
