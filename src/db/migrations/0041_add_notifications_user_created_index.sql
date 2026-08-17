CREATE INDEX IF NOT EXISTS "idx_notifications_user_created"
  ON "notifications" USING btree ("user_id","created_at" DESC);
