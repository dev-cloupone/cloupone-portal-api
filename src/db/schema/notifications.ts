import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { desc } from 'drizzle-orm';
import { users } from './users';

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  link: varchar('link', { length: 500 }),
  isRead: boolean('is_read').notNull().default(false),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Serve getUnreadCount (filtra user_id + is_read).
  index('idx_notifications_user_unread').on(table.userId, table.isRead, table.createdAt),
  // Serve listByUser: filtra so por user_id e ordena por created_at DESC — com
  // is_read no meio, o Postgres nao usa o indice acima para a ordenacao.
  index('idx_notifications_user_created').on(table.userId, desc(table.createdAt)),
]);
