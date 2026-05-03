import { pgTable, uuid, varchar, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 500 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reportPermissions = pgTable('report_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id').notNull().references(() => reports.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  grantedBy: uuid('granted_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('report_permissions_report_user_idx').on(table.reportId, table.userId),
]);

export const reportsRelations = relations(reports, ({ many }) => ({
  permissions: many(reportPermissions),
}));

export const reportPermissionsRelations = relations(reportPermissions, ({ one }) => ({
  report: one(reports, { fields: [reportPermissions.reportId], references: [reports.id] }),
  user: one(users, { fields: [reportPermissions.userId], references: [users.id] }),
  grantedByUser: one(users, { fields: [reportPermissions.grantedBy], references: [users.id] }),
}));
