CREATE TABLE IF NOT EXISTS "project_notification_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "channel_email" boolean DEFAULT true NOT NULL,
  "channel_in_app" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_notification_settings"
    ADD CONSTRAINT "project_notification_settings_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_notification_settings"
    ADD CONSTRAINT "project_notification_settings_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pns_project_user_event_unique" ON "project_notification_settings" USING btree ("project_id","user_id","event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pns_project_event" ON "project_notification_settings" USING btree ("project_id","event_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_notification_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "email" varchar(255) NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_notification_emails"
    ADD CONSTRAINT "project_notification_emails_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pne_project_email_event_unique" ON "project_notification_emails" USING btree ("project_id","email","event_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text,
  "link" varchar(500),
  "is_read" boolean DEFAULT false NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_user_unread" ON "notifications" USING btree ("user_id","is_read","created_at");
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "urgent_notifications_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "notification_sound_enabled" boolean DEFAULT false NOT NULL;
