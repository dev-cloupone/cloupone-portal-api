-- Allow multiple simultaneous draft invoices for fixed_price projects
-- Hourly projects keep the 1-draft-per-project/month limit (regenerateInvoiceDraftForProject relies on it)
DROP INDEX IF EXISTS "invoices_project_month_draft";
CREATE UNIQUE INDEX "invoices_project_month_draft_hourly" ON "invoices" ("project_id", "year", "month") WHERE status = 'draft' AND invoice_type = 'hourly';
