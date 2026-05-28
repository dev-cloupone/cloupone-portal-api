-- Add 'administrative' role to user_role enum
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'administrative';

-- Create consultant_payment_status enum
CREATE TYPE "public"."consultant_payment_status" AS ENUM('draft', 'confirmed', 'paid', 'cancelled');

-- Create expense_payment_status enum
CREATE TYPE "public"."expense_payment_status" AS ENUM('draft', 'confirmed', 'paid', 'cancelled');

-- Add payment_locked to monthly_timesheets
ALTER TABLE "monthly_timesheets" ADD COLUMN "payment_locked" boolean DEFAULT false NOT NULL;

-- Add approved_amount to expenses
ALTER TABLE "expenses" ADD COLUMN "approved_amount" numeric(10, 2);

-- Create consultant_project_rates table
CREATE TABLE "consultant_project_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "cost_rate" numeric(10, 2) NOT NULL,
  "billing_rate" numeric(10, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "consultant_project_rates_user_project_idx" ON "consultant_project_rates" USING btree ("user_id", "project_id");

ALTER TABLE "consultant_project_rates"
  ADD CONSTRAINT "consultant_project_rates_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "consultant_project_rates"
  ADD CONSTRAINT "consultant_project_rates_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;

-- Create consultant_payments table
CREATE TABLE "consultant_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "status" "public"."consultant_payment_status" DEFAULT 'draft' NOT NULL,
  "total_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
  "total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "receipt_file_id" uuid,
  "confirmed_at" timestamp,
  "confirmed_by" uuid,
  "paid_at" timestamp,
  "paid_by" uuid,
  "cancelled_at" timestamp,
  "cancelled_by" uuid,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "consultant_payments_user_idx" ON "consultant_payments" USING btree ("user_id");
CREATE INDEX "consultant_payments_status_idx" ON "consultant_payments" USING btree ("status");

-- Partial unique: only one active (non-cancelled) payment per consultant per month
CREATE UNIQUE INDEX "consultant_payments_user_year_month_active_idx"
  ON "consultant_payments" ("user_id", "year", "month")
  WHERE status != 'cancelled';

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_receipt_file_id_files_id_fk"
  FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_confirmed_by_users_id_fk"
  FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_paid_by_users_id_fk"
  FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_cancelled_by_users_id_fk"
  FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "consultant_payments"
  ADD CONSTRAINT "consultant_payments_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Create consultant_payment_lines table
CREATE TABLE "consultant_payment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "calculated_hours" numeric(8, 2) NOT NULL,
  "applied_hours" numeric(8, 2) NOT NULL,
  "original_rate" numeric(10, 2) NOT NULL,
  "applied_rate" numeric(10, 2) NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "consultant_payment_lines_payment_idx" ON "consultant_payment_lines" USING btree ("payment_id");

ALTER TABLE "consultant_payment_lines"
  ADD CONSTRAINT "consultant_payment_lines_payment_id_consultant_payments_id_fk"
  FOREIGN KEY ("payment_id") REFERENCES "public"."consultant_payments"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "consultant_payment_lines"
  ADD CONSTRAINT "consultant_payment_lines_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;

-- Create expense_payments table
CREATE TABLE "expense_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" "public"."expense_payment_status" DEFAULT 'draft' NOT NULL,
  "total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "receipt_file_id" uuid,
  "confirmed_at" timestamp,
  "confirmed_by" uuid,
  "paid_at" timestamp,
  "paid_by" uuid,
  "cancelled_at" timestamp,
  "cancelled_by" uuid,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "expense_payments_user_idx" ON "expense_payments" USING btree ("user_id");
CREATE INDEX "expense_payments_status_idx" ON "expense_payments" USING btree ("status");

-- Partial unique: only one active (non-cancelled) payment per consultant per period
CREATE UNIQUE INDEX "expense_payments_user_period_active_idx"
  ON "expense_payments" ("user_id", "period_start", "period_end")
  WHERE status != 'cancelled';

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_receipt_file_id_files_id_fk"
  FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_confirmed_by_users_id_fk"
  FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_paid_by_users_id_fk"
  FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_cancelled_by_users_id_fk"
  FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "expense_payments"
  ADD CONSTRAINT "expense_payments_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Create expense_payment_items table
CREATE TABLE "expense_payment_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expense_payment_id" uuid NOT NULL,
  "expense_id" uuid NOT NULL,
  "amount" numeric(10, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX "expense_payment_items_payment_idx" ON "expense_payment_items" USING btree ("expense_payment_id");
CREATE INDEX "expense_payment_items_expense_idx" ON "expense_payment_items" USING btree ("expense_id");

ALTER TABLE "expense_payment_items"
  ADD CONSTRAINT "expense_payment_items_expense_payment_id_expense_payments_id_fk"
  FOREIGN KEY ("expense_payment_id") REFERENCES "public"."expense_payments"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "expense_payment_items"
  ADD CONSTRAINT "expense_payment_items_expense_id_expenses_id_fk"
  FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;
