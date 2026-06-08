import { pgTable, uuid, integer, varchar, decimal, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { clients } from './clients';
import { projects } from './projects';

export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'issued', 'paid', 'cancelled']);
export const invoiceLineTypeEnum = pgEnum('invoice_line_type', ['hours', 'custom']);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceNumber: integer('invoice_number').unique(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  clientCnpj: varchar('client_cnpj', { length: 18 }),
  totalHours: decimal('total_hours', { precision: 8, scale: 2 }).notNull().default('0'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  issuedAt: timestamp('issued_at'),
  issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
  paidAt: timestamp('paid_at'),
  paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('invoices_client_idx').on(table.clientId),
  index('invoices_project_idx').on(table.projectId),
  index('invoices_status_idx').on(table.status),
]);

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  lineType: invoiceLineTypeEnum('line_type').notNull().default('hours'),
  consultantId: uuid('consultant_id').references(() => users.id, { onDelete: 'restrict' }),
  consultantName: varchar('consultant_name', { length: 200 }),
  description: text('description'),
  calculatedHours: decimal('calculated_hours', { precision: 8, scale: 2 }),
  appliedHours: decimal('applied_hours', { precision: 8, scale: 2 }).notNull(),
  originalRate: decimal('original_rate', { precision: 10, scale: 2 }),
  appliedRate: decimal('applied_rate', { precision: 10, scale: 2 }).notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('invoice_lines_invoice_idx').on(table.invoiceId),
]);
