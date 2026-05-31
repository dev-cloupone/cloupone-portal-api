import { pgTable, uuid, integer, decimal, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { files } from './files';

export const consultantPaymentStatusEnum = pgEnum('consultant_payment_status', ['draft', 'confirmed', 'paid', 'cancelled']);

export const consultantPayments = pgTable('consultant_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: consultantPaymentStatusEnum('status').notNull().default('draft'),
  totalHours: decimal('total_hours', { precision: 8, scale: 2 }).notNull().default('0'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull().default('0'),
  receiptFileId: uuid('receipt_file_id').references(() => files.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at'),
  confirmedBy: uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  paidAt: timestamp('paid_at'),
  paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
  cancelledAt: timestamp('cancelled_at'),
  cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('consultant_payments_user_idx').on(table.userId),
  index('consultant_payments_status_idx').on(table.status),
]);

export const consultantPaymentLines = pgTable('consultant_payment_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => consultantPayments.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  calculatedHours: decimal('calculated_hours', { precision: 8, scale: 2 }).notNull(),
  appliedHours: decimal('applied_hours', { precision: 8, scale: 2 }).notNull(),
  originalRate: decimal('original_rate', { precision: 10, scale: 2 }).notNull(),
  appliedRate: decimal('applied_rate', { precision: 10, scale: 2 }).notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('consultant_payment_lines_payment_idx').on(table.paymentId),
]);
