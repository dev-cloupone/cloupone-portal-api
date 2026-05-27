-- Add days edit tracking columns to project_expense_periods
ALTER TABLE "project_expense_periods" ADD COLUMN "days_edited_by" uuid;
ALTER TABLE "project_expense_periods" ADD COLUMN "days_edited_at" timestamp;

ALTER TABLE "project_expense_periods"
  ADD CONSTRAINT "project_expense_periods_days_edited_by_users_id_fk"
  FOREIGN KEY ("days_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
