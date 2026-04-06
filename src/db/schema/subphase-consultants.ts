import { pgTable, uuid, decimal, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { projectSubphases } from './project-subphases';
import { users } from './users';

export const subphaseConsultants = pgTable('subphase_consultants', {
  id: uuid('id').primaryKey().defaultRandom(),
  subphaseId: uuid('subphase_id').notNull().references(() => projectSubphases.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  estimatedHours: decimal('estimated_hours', { precision: 8, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('subphase_consultants_unique_idx').on(table.subphaseId, table.userId),
]);
