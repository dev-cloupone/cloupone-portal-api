-- Migration: Simplify ticket_status enum
-- From: open, in_analysis, in_progress, in_review, resolved, closed, reopened, cancelled
-- To:   open, in_analysis, awaiting_customer, awaiting_third_party, finished

-- Step 1: Create new enum type with desired values
CREATE TYPE "public"."ticket_status_new" AS ENUM('open', 'in_analysis', 'awaiting_customer', 'awaiting_third_party', 'finished');

-- Step 2: Drop default before type change
ALTER TABLE "tickets" ALTER COLUMN "status" DROP DEFAULT;

-- Step 3: Alter column to text temporarily so we can migrate data
ALTER TABLE "tickets" ALTER COLUMN "status" TYPE text USING "status"::text;

-- Step 4: Migrate existing data to new statuses
UPDATE "tickets" SET "status" = 'in_analysis' WHERE "status" IN ('in_progress', 'in_review');
UPDATE "tickets" SET "status" = 'finished' WHERE "status" IN ('resolved', 'closed', 'cancelled');
UPDATE "tickets" SET "status" = 'open' WHERE "status" = 'reopened';

-- Step 5: Convert column to new enum type and restore default
ALTER TABLE "tickets" ALTER COLUMN "status" TYPE "public"."ticket_status_new" USING "status"::"public"."ticket_status_new";
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."ticket_status_new";
ALTER TABLE "tickets" ALTER COLUMN "status" SET NOT NULL;

-- Step 6: Drop old type and rename new
DROP TYPE "public"."ticket_status";
ALTER TYPE "public"."ticket_status_new" RENAME TO "ticket_status";

-- Step 7: Migrate ticket_history old/new values (varchar column, no enum constraint)
UPDATE "ticket_history" SET "new_value" = 'in_analysis' WHERE "field" = 'status' AND "new_value" IN ('in_progress', 'in_review');
UPDATE "ticket_history" SET "new_value" = 'finished' WHERE "field" = 'status' AND "new_value" IN ('resolved', 'closed', 'cancelled');
UPDATE "ticket_history" SET "new_value" = 'open' WHERE "field" = 'status' AND "new_value" = 'reopened';
UPDATE "ticket_history" SET "old_value" = 'in_analysis' WHERE "field" = 'status' AND "old_value" IN ('in_progress', 'in_review');
UPDATE "ticket_history" SET "old_value" = 'finished' WHERE "field" = 'status' AND "old_value" IN ('resolved', 'closed', 'cancelled');
UPDATE "ticket_history" SET "old_value" = 'open' WHERE "field" = 'status' AND "old_value" = 'reopened';
