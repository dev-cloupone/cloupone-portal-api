-- Unique partial index to prevent duplicate active invoices for same project/month
CREATE UNIQUE INDEX "invoices_project_month_active" ON "invoices" ("project_id", "year", "month") WHERE status != 'cancelled';

-- Create enum for invoice line type (replacing varchar)
CREATE TYPE "public"."invoice_line_type" AS ENUM('hours', 'custom');
ALTER TABLE "invoice_lines" ALTER COLUMN "line_type" TYPE "public"."invoice_line_type" USING "line_type"::"public"."invoice_line_type";

-- Standardize decimal precision for expense invoice items to match other monetary columns
ALTER TABLE "expense_invoice_items" ALTER COLUMN "original_amount" TYPE numeric(12, 2);
ALTER TABLE "expense_invoice_items" ALTER COLUMN "applied_amount" TYPE numeric(12, 2);
