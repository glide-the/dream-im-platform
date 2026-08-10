ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_source_type" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "source_run_id" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "source_thread_ref" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "source_project_id" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "episode_count" integer;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_manifest_revision" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "script_revision" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_sync_status" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_sync_error_code" text;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "script_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "artifact_available" boolean;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "reconcile_version" integer;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD COLUMN "reviewed_script_revision" text;--> statement-breakpoint
CREATE UNIQUE INDEX "story_workspace_stories_artifact_identity_uidx" ON "story_workspace_stories" USING btree ("workspace_id","artifact_source_type","source_project_id") WHERE "story_workspace_stories"."artifact_source_type" IS NOT NULL AND "story_workspace_stories"."source_project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "story_workspace_stories_artifact_status_idx" ON "story_workspace_stories" USING btree ("artifact_sync_status","artifact_indexed_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_workspace_project_idx" ON "story_workspace_stories" USING btree ("workspace_id","source_project_id");--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_artifact_source_type_check" CHECK ("story_workspace_stories"."artifact_source_type" IS NULL OR "story_workspace_stories"."artifact_source_type" = 'dream_episode');--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_artifact_sync_status_check" CHECK ("story_workspace_stories"."artifact_sync_status" IS NULL OR "story_workspace_stories"."artifact_sync_status" IN ('syncing', 'indexed', 'stale', 'missing', 'failed'));--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_manifest_revision_check" CHECK ("story_workspace_stories"."artifact_manifest_revision" IS NULL OR "story_workspace_stories"."artifact_manifest_revision" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_script_revision_check" CHECK ("story_workspace_stories"."script_revision" IS NULL OR "story_workspace_stories"."script_revision" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_reviewed_revision_check" CHECK ("story_workspace_stories"."reviewed_script_revision" IS NULL OR "story_workspace_stories"."reviewed_script_revision" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_episode_count_check" CHECK ("story_workspace_stories"."episode_count" IS NULL OR "story_workspace_stories"."episode_count" >= 0);--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_script_size_check" CHECK ("story_workspace_stories"."script_size_bytes" IS NULL OR "story_workspace_stories"."script_size_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_reconcile_version_check" CHECK ("story_workspace_stories"."reconcile_version" IS NULL OR "story_workspace_stories"."reconcile_version" >= 1);