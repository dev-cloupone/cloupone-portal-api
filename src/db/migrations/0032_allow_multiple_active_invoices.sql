-- Allow multiple active invoices per project/month (issued + new draft for unfilled hours)
-- Only prevent duplicate drafts for the same project/month
DROP INDEX IF EXISTS "invoices_project_month_active";
CREATE UNIQUE INDEX "invoices_project_month_draft" ON "invoices" ("project_id", "year", "month") WHERE status = 'draft';
