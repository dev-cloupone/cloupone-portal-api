import { pgTable, uuid, varchar, text, integer, boolean, timestamp, decimal, date, pgEnum, index } from 'drizzle-orm/pg-core';
import { projectPhases } from './project-phases';

export const subphaseStatusEnum = pgEnum('subphase_status', ['planned', 'in_progress', 'completed']);

export const projectSubphases = pgTable('project_subphases', {
  id: uuid('id').primaryKey().defaultRandom(),
  phaseId: uuid('phase_id').notNull().references(() => projectPhases.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: subphaseStatusEnum('status').notNull().default('planned'),
  estimatedHours: decimal('estimated_hours', { precision: 8, scale: 2 }),
  startDate: date('start_date'),
  businessDays: integer('business_days'),
  endDate: date('end_date'),
  order: integer('order').notNull().default(0),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('project_subphases_phase_idx').on(table.phaseId),
]);
