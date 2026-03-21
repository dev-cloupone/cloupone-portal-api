TRUNCATE time_entry_comments, time_entries CASCADE;--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "hours" SET DATA TYPE numeric(4, 2);--> statement-breakpoint
ALTER TABLE "consultant_profiles" ADD COLUMN "allow_overlapping_entries" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "start_time" time NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "end_time" time NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_overlap_idx" ON "time_entries" USING btree ("user_id","date","start_time","end_time");