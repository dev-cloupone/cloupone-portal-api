-- Add billing period columns (nullable first for backfill)
ALTER TABLE "invoices" ADD COLUMN "billing_year" integer;
ALTER TABLE "invoices" ADD COLUMN "billing_month" integer;

ALTER TABLE "consultant_payments" ADD COLUMN "billing_year" integer;
ALTER TABLE "consultant_payments" ADD COLUMN "billing_month" integer;

-- Backfill: billing = reference + 1 month
UPDATE "invoices" SET
  "billing_year" = CASE WHEN "month" = 12 THEN "year" + 1 ELSE "year" END,
  "billing_month" = CASE WHEN "month" = 12 THEN 1 ELSE "month" + 1 END;

UPDATE "consultant_payments" SET
  "billing_year" = CASE WHEN "month" = 12 THEN "year" + 1 ELSE "year" END,
  "billing_month" = CASE WHEN "month" = 12 THEN 1 ELSE "month" + 1 END;

-- Set NOT NULL after backfill
ALTER TABLE "invoices" ALTER COLUMN "billing_year" SET NOT NULL;
ALTER TABLE "invoices" ALTER COLUMN "billing_month" SET NOT NULL;

ALTER TABLE "consultant_payments" ALTER COLUMN "billing_year" SET NOT NULL;
ALTER TABLE "consultant_payments" ALTER COLUMN "billing_month" SET NOT NULL;

-- Create indexes
CREATE INDEX "invoices_billing_period_idx" ON "invoices" ("billing_year", "billing_month");
CREATE INDEX "consultant_payments_billing_period_idx" ON "consultant_payments" ("billing_year", "billing_month");
