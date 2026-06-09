import { pgTable, uuid, integer, varchar, date, decimal, text, timestamp, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { clients } from './clients';
import { projects } from './projects';
import { projectExpensePeriods, expenses } from './expenses';
import { invoiceStatusEnum } from './invoices';

export const expenseInvoices = pgTable('expense_invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceNumber: integer('invoice_number').unique(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  periodId: uuid('period_id').notNull().references(() => projectExpensePeriods.id, { onDelete: 'restrict' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: invoiceStatusEnum('status').notNull().default('draft'),
  clientName: varchar('client_name', { length: 255 }).notNull(),
  clientCnpj: varchar('client_cnpj', { length: 18 }),
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
  index('expense_invoices_client_idx').on(table.clientId),
  index('expense_invoices_project_idx').on(table.projectId),
  index('expense_invoices_status_idx').on(table.status),
]);

export const expenseInvoiceItems = pgTable('expense_invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseInvoiceId: uuid('expense_invoice_id').notNull().references(() => expenseInvoices.id, { onDelete: 'cascade' }),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id, { onDelete: 'restrict' }),
  description: text('description'),
  originalAmount: decimal('original_amount', { precision: 12, scale: 2 }).notNull(),
  appliedAmount: decimal('applied_amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('expense_invoice_items_invoice_idx').on(table.expenseInvoiceId),
  index('expense_invoice_items_expense_idx').on(table.expenseId),
]);
