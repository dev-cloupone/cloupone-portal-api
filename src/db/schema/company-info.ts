import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const companyInfo = pgTable('company_info', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  cnpj: varchar('cnpj', { length: 20 }).notNull(),
  address: varchar('address', { length: 500 }).notNull(),
  zipCode: varchar('zip_code', { length: 15 }).notNull(),
  cityState: varchar('city_state', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  email: varchar('email', { length: 255 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id).notNull(),
});
