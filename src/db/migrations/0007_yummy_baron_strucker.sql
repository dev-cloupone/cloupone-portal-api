-- Migration 0007: Monthly timesheets - replace per-entry approval with per-month approval
-- Made idempotent to handle databases already at the final state.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'monthly_timesheet_status') THEN
    CREATE TYPE "public"."monthly_timesheet_status" AS ENUM('open', 'approved', 'reopened');
  END IF;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "monthly_timesheet_status" DEFAULT 'open' NOT NULL,
	"approved_at" timestamp,
	"approved_by_id" uuid,
	"reopened_at" timestamp,
	"reopened_by_id" uuid,
	"reopen_reason" text,
	"escalated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'time_entry_comments') THEN
    ALTER TABLE "time_entry_comments" DISABLE ROW LEVEL SECURITY;
    DROP TABLE "time_entry_comments" CASCADE;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'time_entries_approved_by_users_id_fk') THEN
    ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_approved_by_users_id_fk";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'time_entries_user_status_idx') THEN
    DROP INDEX "time_entries_user_status_idx";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'monthly_timesheets_user_id_users_id_fk') THEN
    ALTER TABLE "monthly_timesheets" ADD CONSTRAINT "monthly_timesheets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'monthly_timesheets_approved_by_id_users_id_fk') THEN
    ALTER TABLE "monthly_timesheets" ADD CONSTRAINT "monthly_timesheets_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'monthly_timesheets_reopened_by_id_users_id_fk') THEN
    ALTER TABLE "monthly_timesheets" ADD CONSTRAINT "monthly_timesheets_reopened_by_id_users_id_fk" FOREIGN KEY ("reopened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "monthly_timesheets_user_year_month_idx" ON "monthly_timesheets" USING btree ("user_id","year","month");--> statement-breakpoint
-- Populate monthly_timesheets from time_entries (only if time_entries still has status column)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'status') THEN
    INSERT INTO "monthly_timesheets" ("user_id", "year", "month", "status", "approved_at")
    SELECT
      te."user_id",
      EXTRACT(YEAR FROM te."date")::integer AS "year",
      EXTRACT(MONTH FROM te."date")::integer AS "month",
      CASE
        WHEN bool_or(te."status" = 'rejected') THEN 'reopened'::"monthly_timesheet_status"
        WHEN bool_and(te."status" IN ('approved', 'auto_approved')) THEN 'approved'::"monthly_timesheet_status"
        ELSE 'open'::"monthly_timesheet_status"
      END AS "status",
      CASE
        WHEN bool_and(te."status" IN ('approved', 'auto_approved')) THEN MAX(te."approved_at")
        ELSE NULL
      END AS "approved_at"
    FROM "time_entries" te
    GROUP BY te."user_id", EXTRACT(YEAR FROM te."date"), EXTRACT(MONTH FROM te."date")
    ON CONFLICT DO NOTHING;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'consultant_profiles' AND column_name = 'requires_approval') THEN
    ALTER TABLE "consultant_profiles" DROP COLUMN "requires_approval";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'status') THEN
    ALTER TABLE "time_entries" DROP COLUMN "status";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'submitted_at') THEN
    ALTER TABLE "time_entries" DROP COLUMN "submitted_at";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'approved_at') THEN
    ALTER TABLE "time_entries" DROP COLUMN "approved_at";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'time_entries' AND column_name = 'approved_by') THEN
    ALTER TABLE "time_entries" DROP COLUMN "approved_by";
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_entry_status') THEN
    DROP TYPE "public"."time_entry_status";
  END IF;
END $$;