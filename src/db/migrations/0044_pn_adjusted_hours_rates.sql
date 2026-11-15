ALTER TABLE "time_entries" ADD COLUMN "adjusted_hours" numeric(4, 2);
UPDATE "time_entries" SET "adjusted_hours" = "hours" WHERE "adjusted_hours" IS NULL;
ALTER TABLE "time_entries" ALTER COLUMN "adjusted_hours" SET NOT NULL;

ALTER TABLE "project_allocations" ADD COLUMN "partner_billing_rate" numeric(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE "project_allocations" ADD COLUMN "partner_cost_rate" numeric(10, 2) NOT NULL DEFAULT 0.00;
