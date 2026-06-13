import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const importLogs = pgTable('import_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  consultantId: uuid('consultant_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  totalRows: integer('total_rows').notNull(),
  imported: integer('imported').notNull(),
  skipped: integer('skipped').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
