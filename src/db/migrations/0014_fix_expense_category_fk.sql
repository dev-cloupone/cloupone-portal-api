-- Expenses V2 Fix: Migrate expense_category_id FK from expense_category_templates to project_expense_categories
-- This migration preserves existing data by auto-creating project categories where needed.

-- 1. Drop old FK constraint first so we can update the data
--    The original constraint was named with "expense_categories" (pre-rename) or "expense_category_templates" (post-rename)
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS "expenses_expense_category_id_expense_categories_id_fk";
--> statement-breakpoint
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS "expenses_expense_category_id_expense_category_templates_id_fk";
--> statement-breakpoint
-- 2. Backfill: create project_expense_categories for (project_id, template_id) pairs
--    that exist in expenses but not yet in project_expense_categories
INSERT INTO project_expense_categories (project_id, template_id, name, max_amount, km_rate, requires_receipt, is_km_category, sort_order, is_active)
SELECT DISTINCT e.project_id, e.expense_category_id, t.name, t.default_max_amount, t.default_km_rate, t.requires_receipt, t.is_km_category, t.sort_order, t.is_active
FROM expenses e
JOIN expense_category_templates t ON t.id = e.expense_category_id
WHERE e.expense_category_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM project_expense_categories pec
  WHERE pec.project_id = e.project_id AND pec.template_id = e.expense_category_id
);
--> statement-breakpoint
-- 3. Update expenses to point to the corresponding project_expense_categories row
UPDATE expenses e
SET expense_category_id = pec.id
FROM project_expense_categories pec
WHERE pec.project_id = e.project_id
AND pec.template_id = e.expense_category_id
AND e.expense_category_id IS NOT NULL
AND e.expense_category_id IN (SELECT id FROM expense_category_templates);
--> statement-breakpoint
-- 4. Add new FK constraint pointing to project_expense_categories
ALTER TABLE expenses ADD CONSTRAINT "expenses_expense_category_id_project_expense_categories_id_fk"
  FOREIGN KEY (expense_category_id) REFERENCES project_expense_categories(id) ON DELETE SET NULL;
