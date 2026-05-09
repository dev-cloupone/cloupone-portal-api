import { pgTable, pgEnum, uuid, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const accountTypeEnum = pgEnum('account_type', ['corrente', 'poupanca']);

export const bankAccounts = pgTable('bank_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: varchar('label', { length: 100 }).notNull(),
  holderName: varchar('holder_name', { length: 255 }).notNull(),
  bankName: varchar('bank_name', { length: 255 }).notNull(),
  agency: varchar('agency', { length: 20 }).notNull(),
  accountNumber: varchar('account_number', { length: 30 }).notNull(),
  accountType: accountTypeEnum('account_type').notNull(),
  pixKey: varchar('pix_key', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id).notNull(),
});
