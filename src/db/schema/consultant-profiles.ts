import { pgTable, uuid, decimal, boolean, pgEnum, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const contractTypeEnum = pgEnum('contract_type', ['clt', 'pj', 'horista']);

export const consultantProfiles = pgTable('consultant_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }).notNull(),
  contractType: contractTypeEnum('contract_type').notNull().default('pj'),
  allowOverlappingEntries: boolean('allow_overlapping_entries').default(false).notNull(),
  requiresApproval: boolean('requires_approval').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
