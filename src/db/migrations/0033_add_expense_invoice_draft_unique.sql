-- Partial unique: only one draft expense invoice per project per period
CREATE UNIQUE INDEX IF NOT EXISTS "expense_invoices_project_period_draft_unique"
ON "expense_invoices" ("project_id", "period_id")
WHERE status = 'draft';
