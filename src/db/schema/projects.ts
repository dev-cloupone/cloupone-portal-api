import { pgTable, uuid, varchar, text, decimal, integer, boolean, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { clients } from './clients';

export const projectStatusEnum = pgEnum('project_status', ['active', 'paused', 'finished']);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  status: projectStatusEnum('status').notNull().default('active'),
  billingRate: decimal('billing_rate', { precision: 10, scale: 2 }).notNull(),
  budgetHours: integer('budget_hours'),
  budgetType: varchar('budget_type', { length: 20 }).default('monthly'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  ticketPrefix: varchar('ticket_prefix', { length: 10 }),
  ticketSequence: integer('ticket_sequence').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
