-- Migration: Redesign ticket_type enum
-- From: bug, improvement, initiative
-- To:   system_error, question, improvement, security
--
-- Data mapping:
--   bug        -> system_error
--   improvement -> improvement (unchanged)
--   initiative -> improvement (best-fit fallback; no equivalent in new taxonomy)

-- Step 1: Create new enum type with desired values
CREATE TYPE "public"."ticket_type_new" AS ENUM('system_error', 'question', 'improvement', 'security');

-- Step 2: Alter column to text temporarily so we can migrate data
ALTER TABLE "tickets" ALTER COLUMN "type" TYPE text USING "type"::text;

-- Step 3: Migrate existing data to new type values
UPDATE "tickets" SET "type" = 'system_error' WHERE "type" = 'bug';
UPDATE "tickets" SET "type" = 'improvement' WHERE "type" = 'initiative';

-- Step 4: Convert column to new enum type
ALTER TABLE "tickets" ALTER COLUMN "type" TYPE "public"."ticket_type_new" USING "type"::"public"."ticket_type_new";
ALTER TABLE "tickets" ALTER COLUMN "type" SET NOT NULL;

-- Step 5: Drop old type and rename new
DROP TYPE "public"."ticket_type";
ALTER TYPE "public"."ticket_type_new" RENAME TO "ticket_type";

-- Step 6: Migrate ticket_history old/new values (varchar column, no enum constraint)
UPDATE "ticket_history" SET "new_value" = 'system_error' WHERE "field" = 'type' AND "new_value" = 'bug';
UPDATE "ticket_history" SET "new_value" = 'improvement' WHERE "field" = 'type' AND "new_value" = 'initiative';
UPDATE "ticket_history" SET "old_value" = 'system_error' WHERE "field" = 'type' AND "old_value" = 'bug';
UPDATE "ticket_history" SET "old_value" = 'improvement' WHERE "field" = 'type' AND "old_value" = 'initiative';
