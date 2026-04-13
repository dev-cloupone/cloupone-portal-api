-- Migration: Rename user_role enum value 'user' -> 'client'
-- Step 1: Convert role column to text temporarily
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'client'::text;--> statement-breakpoint
-- Step 2: Migrate existing data
UPDATE "users" SET "role" = 'client' WHERE "role" = 'user';--> statement-breakpoint
-- Step 3: Drop old enum and create new one
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'gestor', 'consultor', 'client');--> statement-breakpoint
-- Step 4: Convert column back to enum
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'client'::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";
