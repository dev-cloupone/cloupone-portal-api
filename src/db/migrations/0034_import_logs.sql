CREATE TABLE IF NOT EXISTS "import_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "consultant_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "filename" varchar(255) NOT NULL,
  "total_rows" integer NOT NULL,
  "imported" integer NOT NULL,
  "skipped" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
