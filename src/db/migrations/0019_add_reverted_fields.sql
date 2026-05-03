-- Add revert tracking columns to expenses
ALTER TABLE "expenses" ADD COLUMN "reverted_by" uuid;
ALTER TABLE "expenses" ADD COLUMN "reverted_at" timestamp;

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_reverted_by_users_id_fk"
  FOREIGN KEY ("reverted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
