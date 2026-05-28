import { pgTable, uuid, decimal, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';

export const consultantProjectRates = pgTable('consultant_project_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  costRate: decimal('cost_rate', { precision: 10, scale: 2 }).notNull(),
  billingRate: decimal('billing_rate', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('consultant_project_rates_user_project_idx').on(table.userId, table.projectId),
]);
