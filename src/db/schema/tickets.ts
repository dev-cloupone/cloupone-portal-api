import { pgTable, uuid, varchar, text, boolean, timestamp, date, decimal, jsonb, integer, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { files } from './files';

export const ticketTypeEnum = pgEnum('ticket_type', ['bug', 'improvement', 'initiative']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);
export const ticketStatusEnum = pgEnum('ticket_status', [
  'open', 'in_analysis', 'awaiting_customer', 'awaiting_third_party', 'finished',
]);

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  type: ticketTypeEnum('type').notNull(),
  priority: ticketPriorityEnum('priority').notNull().default('medium'),
  status: ticketStatusEnum('status').notNull().default('open'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  metadata: jsonb('metadata'),
  isVisibleToClient: boolean('is_visible_to_client').default(true).notNull(),
  dueDate: date('due_date'),
  estimatedHours: decimal('estimated_hours', { precision: 6, scale: 1 }),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('tickets_project_code_unique').on(table.projectId, table.code),
  index('tickets_project_id_idx').on(table.projectId),
  index('tickets_assigned_to_idx').on(table.assignedTo),
  index('tickets_status_idx').on(table.status),
  index('tickets_created_by_idx').on(table.createdBy),
  index('tickets_project_status_idx').on(table.projectId, table.status),
]);

export const ticketComments = pgTable('ticket_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  content: text('content').notNull(),
  isInternal: boolean('is_internal').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('ticket_comments_ticket_created_idx').on(table.ticketId, table.createdAt),
]);

export const ticketHistory = pgTable('ticket_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  field: varchar('field', { length: 50 }).notNull(),
  oldValue: varchar('old_value', { length: 500 }),
  newValue: varchar('new_value', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('ticket_history_ticket_created_idx').on(table.ticketId, table.createdAt),
]);

export const ticketAttachments = pgTable('ticket_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  fileId: uuid('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('ticket_attachments_ticket_idx').on(table.ticketId),
]);
