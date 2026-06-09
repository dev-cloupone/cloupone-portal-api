-- Shared invoice number sequence
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" START 1;

-- Invoice status enum
DO $$ BEGIN
  CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Invoices (hours)
CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" integer UNIQUE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE restrict,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE restrict,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "status" "invoice_status" DEFAULT 'draft' NOT NULL,
  "client_name" varchar(255) NOT NULL,
  "client_cnpj" varchar(18),
  "total_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
  "total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "issued_at" timestamp,
  "issued_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "paid_at" timestamp,
  "paid_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "cancelled_at" timestamp,
  "cancelled_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "invoices_client_idx" ON "invoices" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "invoices_project_idx" ON "invoices" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices" USING btree ("status");

-- Invoice lines
CREATE TABLE IF NOT EXISTS "invoice_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE cascade,
  "line_type" varchar(10) DEFAULT 'hours' NOT NULL,
  "consultant_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "consultant_name" varchar(200),
  "description" text,
  "calculated_hours" numeric(8, 2),
  "applied_hours" numeric(8, 2) NOT NULL,
  "original_rate" numeric(10, 2),
  "applied_rate" numeric(10, 2) NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");

-- Expense invoices
CREATE TABLE IF NOT EXISTS "expense_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_number" integer UNIQUE,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE restrict,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE restrict,
  "period_id" uuid NOT NULL REFERENCES "project_expense_periods"("id") ON DELETE restrict,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" "invoice_status" DEFAULT 'draft' NOT NULL,
  "client_name" varchar(255) NOT NULL,
  "client_cnpj" varchar(18),
  "total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "issued_at" timestamp,
  "issued_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "paid_at" timestamp,
  "paid_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "cancelled_at" timestamp,
  "cancelled_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "notes" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "expense_invoices_client_idx" ON "expense_invoices" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "expense_invoices_project_idx" ON "expense_invoices" USING btree ("project_id");
CREATE INDEX IF NOT EXISTS "expense_invoices_status_idx" ON "expense_invoices" USING btree ("status");

-- Expense invoice items
CREATE TABLE IF NOT EXISTS "expense_invoice_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "expense_invoice_id" uuid NOT NULL REFERENCES "expense_invoices"("id") ON DELETE cascade,
  "expense_id" uuid NOT NULL REFERENCES "expenses"("id") ON DELETE restrict,
  "description" text,
  "original_amount" numeric(10, 2) NOT NULL,
  "applied_amount" numeric(10, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "expense_invoice_items_invoice_idx" ON "expense_invoice_items" USING btree ("expense_invoice_id");
CREATE INDEX IF NOT EXISTS "expense_invoice_items_expense_idx" ON "expense_invoice_items" USING btree ("expense_id");
