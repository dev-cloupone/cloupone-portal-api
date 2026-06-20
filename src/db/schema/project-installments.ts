import { pgTable, pgEnum, uuid, integer, varchar, decimal, date, timestamp, index } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { invoices } from './invoices';

export const installmentStatusEnum = pgEnum('installment_status', ['pending', 'invoiced', 'paid']);

export const projectInstallments = pgTable('project_installments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  installmentNumber: integer('installment_number').notNull(),
  description: varchar('description', { length: 255 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  dueDate: date('due_date'),
  status: installmentStatusEnum('status').notNull().default('pending'),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('project_installments_project_idx').on(table.projectId),
  index('project_installments_status_idx').on(table.status),
]);
