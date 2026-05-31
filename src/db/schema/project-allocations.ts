import { pgTable, uuid, decimal, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';
import { projects } from './projects';

export const projectAllocations = pgTable('project_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  costRate: decimal('cost_rate', { precision: 10, scale: 2 }).notNull().default('0.00'),
  billingRate: decimal('billing_rate', { precision: 10, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('project_user_unique').on(table.projectId, table.userId),
]);
