-- Migration 0006: Add auto_approved to time_entry_status and requires_approval to consultant_profiles
-- These changes were later reverted by migration 0007 (monthly timesheets).
-- Made idempotent to handle databases already at the final state.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_entry_status') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'auto_approved' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'time_entry_status')) THEN
      ALTER TYPE "public"."time_entry_status" ADD VALUE 'auto_approved';
    END IF;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'consultant_profiles' AND column_name = 'requires_approval') THEN
    ALTER TABLE "consultant_profiles" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;
  END IF;
END $$;