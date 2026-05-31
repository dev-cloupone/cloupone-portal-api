CREATE UNIQUE INDEX IF NOT EXISTS "expense_payments_user_draft_unique" ON "expense_payments" ("user_id") WHERE status = 'draft';
