-- Add rate columns to project_allocations
ALTER TABLE "project_allocations" ADD COLUMN "cost_rate" numeric(10, 2) DEFAULT '0.00' NOT NULL;
ALTER TABLE "project_allocations" ADD COLUMN "billing_rate" numeric(10, 2) DEFAULT '0.00' NOT NULL;
ALTER TABLE "project_allocations" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;

-- Copy data from consultant_project_rates into project_allocations
UPDATE project_allocations pa
SET cost_rate = cpr.cost_rate,
    billing_rate = cpr.billing_rate,
    updated_at = cpr.updated_at
FROM consultant_project_rates cpr
WHERE pa.user_id = cpr.user_id AND pa.project_id = cpr.project_id;

-- Drop consultant_project_rates table
DROP INDEX IF EXISTS "consultant_project_rates_user_project_idx";
ALTER TABLE "consultant_project_rates" DROP CONSTRAINT IF EXISTS "consultant_project_rates_user_id_users_id_fk";
ALTER TABLE "consultant_project_rates" DROP CONSTRAINT IF EXISTS "consultant_project_rates_project_id_projects_id_fk";
DROP TABLE "consultant_project_rates";
