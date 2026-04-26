ALTER TABLE "project_expense_categories"
ADD CONSTRAINT "project_expense_categories_project_template_unique"
UNIQUE ("project_id", "template_id");
