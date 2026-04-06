CREATE TYPE "public"."subphase_status" AS ENUM('planned', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_subphases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phase_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"status" "subphase_status" DEFAULT 'planned' NOT NULL,
	"estimated_hours" numeric(8, 2),
	"start_date" date,
	"business_days" integer,
	"end_date" date,
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subphase_consultants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subphase_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"estimated_hours" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "subphase_id" uuid;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_subphases" ADD CONSTRAINT "project_subphases_phase_id_project_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."project_phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subphase_consultants" ADD CONSTRAINT "subphase_consultants_subphase_id_project_subphases_id_fk" FOREIGN KEY ("subphase_id") REFERENCES "public"."project_subphases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subphase_consultants" ADD CONSTRAINT "subphase_consultants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_subphases_phase_idx" ON "project_subphases" USING btree ("phase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subphase_consultants_unique_idx" ON "subphase_consultants" USING btree ("subphase_id","user_id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_subphase_id_project_subphases_id_fk" FOREIGN KEY ("subphase_id") REFERENCES "public"."project_subphases"("id") ON DELETE set null ON UPDATE no action;