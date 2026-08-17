import { pgTable, uuid, varchar, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

export const projectNotificationSettings = pgTable('project_notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  channelEmail: boolean('channel_email').notNull().default(true),
  channelInApp: boolean('channel_in_app').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('pns_project_user_event_unique').on(table.projectId, table.userId, table.eventType),
  index('idx_pns_project_event').on(table.projectId, table.eventType),
]);
