-- Remove deprecated clientChargeAmount columns from expenses
-- These were replaced by approvedAmount in the financial module refactoring
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "client_charge_amount";
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "client_charge_amount_manually_set";
