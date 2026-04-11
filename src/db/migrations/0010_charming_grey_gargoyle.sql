-- Migration: allow nullable new_value in ticket_history (sentinel for description edits)
ALTER TABLE "ticket_history" ALTER COLUMN "new_value" DROP NOT NULL;
