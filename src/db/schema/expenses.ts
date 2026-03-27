import { pgTable, uuid, varchar, text, decimal, boolean, integer, timestamp, date, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { files } from './files';

// Enum
export const expenseStatusEnum = pgEnum('expense_status', ['draft', 'submitted', 'approved', 'rejected']);

// Categories
export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  maxAmount: decimal('max_amount', { precision: 10, scale: 2 }),
  requiresReceipt: boolean('requires_receipt').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Templates (defined before expenses for FK reference)
export const expenseTemplates = pgTable('expense_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  expenseCategoryId: uuid('expense_category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  description: text('description'),
  amount: decimal('amount', { precision: 10, scale: 2 }),
  requiresReimbursement: boolean('requires_reimbursement').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Expenses
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  consultantUserId: uuid('consultant_user_id').references(() => users.id, { onDelete: 'set null' }),
  expenseCategoryId: uuid('expense_category_id').references(() => expenseCategories.id, { onDelete: 'set null' }),
  date: date('date').notNull(),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  receiptFileId: uuid('receipt_file_id').references(() => files.id, { onDelete: 'set null' }),
  requiresReimbursement: boolean('requires_reimbursement').default(false).notNull(),
  status: expenseStatusEnum('status').notNull().default('draft'),
  autoApproved: boolean('auto_approved').default(false).notNull(),
  submittedAt: timestamp('submitted_at'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  reimbursedAt: timestamp('reimbursed_at'),
  reimbursedBy: uuid('reimbursed_by').references(() => users.id, { onDelete: 'set null' }),
  templateId: uuid('template_id').references(() => expenseTemplates.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('expenses_created_by_date_idx').on(table.createdByUserId, table.date),
  index('expenses_created_by_status_idx').on(table.createdByUserId, table.status),
  index('expenses_project_idx').on(table.projectId),
  index('expenses_consultant_idx').on(table.consultantUserId),
]);

// Comments
export const expenseComments = pgTable('expense_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  expenseId: uuid('expense_id').notNull().references(() => expenses.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
