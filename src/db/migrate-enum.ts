/**
 * Migration script for adding 'created' to expense_status enum.
 *
 * Postgres does not allow ALTER TYPE ... ADD VALUE inside a transaction,
 * and Drizzle Kit wraps migrations in transactions — so this must run separately.
 *
 * Usage: npm run db:migrate:enum
 *
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import 'dotenv/config';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required.');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Step 1: Add 'created' to enum (must run outside a transaction)
    console.log('[1/2] Adding "created" to expense_status enum...');
    await pool.query(`ALTER TYPE expense_status ADD VALUE IF NOT EXISTS 'created'`);
    console.log('      Done.');

    // Step 2: Migrate existing data
    console.log('[2/2] Migrating existing draft/submitted expenses to "created"...');
    const result = await pool.query(`UPDATE expenses SET status = 'created' WHERE status IN ('draft', 'submitted')`);
    console.log(`      Done. ${result.rowCount} row(s) updated.`);

    console.log('\nMigration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
