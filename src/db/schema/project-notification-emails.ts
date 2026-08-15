import { pgTable, uuid, varchar, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { projects } from './projects';

export const projectNotificationEmails = pgTable('project_notification_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('pne_project_email_event_unique').on(table.projectId, table.email, table.eventType),
]);
