-- This migration is a NO-OP via drizzle-kit migrate.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction (Postgres limitation).
-- The actual migration is handled by: npm run db:migrate:enum
-- See: src/db/migrate-enum.ts
SELECT 1;
