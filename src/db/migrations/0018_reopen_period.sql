-- Add reopen tracking columns to project_expense_periods
ALTER TABLE "project_expense_periods" ADD COLUMN "reopened_by" uuid;
ALTER TABLE "project_expense_periods" ADD COLUMN "reopened_at" timestamp;

ALTER TABLE "project_expense_periods"
  ADD CONSTRAINT "project_expense_periods_reopened_by_users_id_fk"
  FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
