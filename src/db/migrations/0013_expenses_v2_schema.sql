-- Expenses V2: Schema & Migration
-- Custom migration to preserve data during table rename

-- 1. New enum for expense period status
DO $$ BEGIN
  CREATE TYPE "public"."expense_period_status" AS ENUM('open', 'closed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Rename expense_categories → expense_category_templates
ALTER TABLE "expense_categories" RENAME TO "expense_category_templates";

-- 3. Rename column max_amount → default_max_amount
ALTER TABLE "expense_category_templates" RENAME COLUMN "max_amount" TO "default_max_amount";

-- 4. Add new columns to expense_category_templates
ALTER TABLE "expense_category_templates" ADD COLUMN "default_km_rate" numeric(10, 2);
ALTER TABLE "expense_category_templates" ADD COLUMN "is_km_category" boolean NOT NULL DEFAULT false;

-- 5. Create project_expense_categories table
CREATE TABLE IF NOT EXISTS "project_expense_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "template_id" uuid,
  "name" varchar(100) NOT NULL,
  "max_amount" numeric(10, 2),
  "km_rate" numeric(10, 2),
  "requires_receipt" boolean NOT NULL DEFAULT true,
  "is_km_category" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "project_expense_categories"
  ADD CONSTRAINT "project_expense_categories_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "project_expense_categories"
  ADD CONSTRAINT "project_expense_categories_template_id_expense_category_templates_id_fk"
  FOREIGN KEY ("template_id") REFERENCES "public"."expense_category_templates"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "project_expense_categories_project_idx" ON "project_expense_categories" USING btree ("project_id");

-- 6. Create project_expense_periods table
CREATE TABLE IF NOT EXISTS "project_expense_periods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "week_start" date NOT NULL,
  "week_end" date NOT NULL,
  "custom_days" jsonb,
  "status" "expense_period_status" NOT NULL DEFAULT 'open',
  "opened_by" uuid NOT NULL,
  "opened_at" timestamp DEFAULT now() NOT NULL,
  "closed_by" uuid,
  "closed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "project_expense_periods"
  ADD CONSTRAINT "project_expense_periods_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "project_expense_periods"
  ADD CONSTRAINT "project_expense_periods_opened_by_users_id_fk"
  FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "project_expense_periods"
  ADD CONSTRAINT "project_expense_periods_closed_by_users_id_fk"
  FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "project_expense_periods_project_idx" ON "project_expense_periods" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "project_expense_periods_project_week_idx" ON "project_expense_periods" USING btree ("project_id", "week_start");

-- 7. Add new columns to expenses table
ALTER TABLE "expenses" ADD COLUMN "km_quantity" numeric(10, 2);
ALTER TABLE "expenses" ADD COLUMN "client_charge_amount" numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE "expenses" ADD COLUMN "client_charge_amount_manually_set" boolean NOT NULL DEFAULT false;

-- 8. Make description nullable
ALTER TABLE "expenses" ALTER COLUMN "description" DROP NOT NULL;

-- 9. Backfill client_charge_amount with amount for existing data
UPDATE "expenses" SET "client_charge_amount" = "amount" WHERE "client_charge_amount" = 0 AND "amount" IS NOT NULL;
