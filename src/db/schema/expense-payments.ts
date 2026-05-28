import { pgTable, uuid, date, decimal, text, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { expenses } from './expenses';
import { files } from './files';

export const expensePaymentStatusEnum = pgEnum('expense_payment_status', ['draft', 'confirmed', 'paid', 'cancelled']);

export const expensePayments = pgTable('expense_payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: expensePaymentStatusEnum('status').notNull().default('draft'),
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
  index('expense_payments_user_idx').on(table.userId),
  index('expense_payments_status_idx').on(table.status),
]);

export const expensePaymentItems = pgTable('expense_payment_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  expensePaymentId: uuid('expense_payment_id').notNull().references(() => expensePayments.id, { onDelete: 'cascade' }),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('expense_payment_items_payment_idx').on(table.expensePaymentId),
  index('expense_payment_items_expense_idx').on(table.expenseId),
]);
