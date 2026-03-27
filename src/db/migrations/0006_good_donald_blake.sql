ALTER TYPE "public"."time_entry_status" ADD VALUE 'auto_approved';--> statement-breakpoint
ALTER TABLE "consultant_profiles" ADD COLUMN "requires_approval" boolean DEFAULT false NOT NULL;