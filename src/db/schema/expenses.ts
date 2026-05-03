import { pgTable, uuid, varchar, text, decimal, boolean, timestamp, date, pgEnum, index, jsonb, unique } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';
import { files } from './files';

// Enums
/** @note 'draft' and 'submitted' are deprecated — all records were migrated to 'created'. Kept due to Postgres enum limitation (cannot remove values). */
export const expenseStatusEnum = pgEnum('expense_status', ['draft', 'submitted', 'created', 'approved', 'rejected']);
export const expensePeriodStatusEnum = pgEnum('expense_period_status', ['open', 'closed']);

// Category Templates (global, managed by admin)
export const expenseCategoryTemplates = pgTable('expense_category_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  defaultMaxAmount: decimal('default_max_amount', { precision: 10, scale: 2 }),
  defaultKmRate: decimal('default_km_rate', { precision: 10, scale: 2 }),
  requiresReceipt: boolean('requires_receipt').default(true).notNull(),
  isKmCategory: boolean('is_km_category').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Project Expense Categories (per-project, imported from templates)
export const projectExpenseCategories = pgTable('project_expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  templateId: uuid('template_id').references(() => expenseCategoryTemplates.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 100 }).notNull(),
  maxAmount: decimal('max_amount', { precision: 10, scale: 2 }),
  kmRate: decimal('km_rate', { precision: 10, scale: 2 }),
  requiresReceipt: boolean('requires_receipt').default(true).notNull(),
  isKmCategory: boolean('is_km_category').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('project_expense_categories_project_idx').on(table.projectId),
  unique('project_expense_categories_project_template_unique').on(table.projectId, table.templateId),
]);

// Project Expense Periods (weekly, managed by gestor)
export const projectExpensePeriods = pgTable('project_expense_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  weekStart: date('week_start').notNull(),
  weekEnd: date('week_end').notNull(),
  customDays: jsonb('custom_days').$type<string[] | null>(),
  status: expensePeriodStatusEnum('status').default('open').notNull(),
  openedBy: uuid('opened_by').notNull().references(() => users.id),
  openedAt: timestamp('opened_at').defaultNow().notNull(),
  closedBy: uuid('closed_by').references(() => users.id),
  closedAt: timestamp('closed_at'),
  reopenedBy: uuid('reopened_by').references(() => users.id),
  reopenedAt: timestamp('reopened_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('project_expense_periods_project_idx').on(table.projectId),
  index('project_expense_periods_project_week_idx').on(table.projectId, table.weekStart),
]);

// Expense Templates (user-specific quick-fill templates)
export const expenseTemplates = pgTable('expense_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  expenseCategoryId: uuid('expense_category_id').references(() => expenseCategoryTemplates.id, { onDelete: 'set null' }),
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
  expenseCategoryId: uuid('expense_category_id').references(() => projectExpenseCategories.id, { onDelete: 'set null' }),
  date: date('date').notNull(),
  description: text('description'),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  receiptFileId: uuid('receipt_file_id').references(() => files.id, { onDelete: 'set null' }),
  requiresReimbursement: boolean('requires_reimbursement').default(false).notNull(),
  status: expenseStatusEnum('status').notNull().default('created'),
  /** @deprecated V2 removed auto-approval. Field kept for backwards compatibility. */
  autoApproved: boolean('auto_approved').default(false).notNull(),
  kmQuantity: decimal('km_quantity', { precision: 10, scale: 2 }),
  clientChargeAmount: decimal('client_charge_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  clientChargeAmountManuallySet: boolean('client_charge_amount_manually_set').default(false).notNull(),
  submittedAt: timestamp('submitted_at'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  reimbursedAt: timestamp('reimbursed_at'),
  reimbursedBy: uuid('reimbursed_by').references(() => users.id, { onDelete: 'set null' }),
  revertedBy: uuid('reverted_by').references(() => users.id, { onDelete: 'set null' }),
  revertedAt: timestamp('reverted_at'),
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
