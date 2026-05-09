DO $$ BEGIN
  CREATE TYPE "public"."account_type" AS ENUM('corrente', 'poupanca');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_info" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" varchar(255) NOT NULL,
	"cnpj" varchar(20) NOT NULL,
	"address" varchar(500) NOT NULL,
	"zip_code" varchar(15) NOT NULL,
	"city_state" varchar(255) NOT NULL,
	"phone" varchar(20),
	"email" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" varchar(100) NOT NULL,
	"holder_name" varchar(255) NOT NULL,
	"bank_name" varchar(255) NOT NULL,
	"agency" varchar(20) NOT NULL,
	"account_number" varchar(30) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"pix_key" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "company_info" ADD CONSTRAINT "company_info_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
