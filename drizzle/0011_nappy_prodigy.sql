DROP INDEX "idx_sw_stories_author";--> statement-breakpoint
DROP INDEX "idx_sw_stories_review_status";--> statement-breakpoint
DROP INDEX "idx_sw_stories_status";--> statement-breakpoint
DROP INDEX "idx_sw_stories_type";--> statement-breakpoint
DROP INDEX "idx_sw_stories_search";--> statement-breakpoint
DROP INDEX "idx_sw_stories_agent";--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
DROP INDEX "idx_sw_workspaces_owner";--> statement-breakpoint
UPDATE "users"
SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
    "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP),
    "role" = COALESCE("role", 'user');--> statement-breakpoint
UPDATE "story_workspace_workspaces"
SET "settings" = COALESCE(NULLIF(BTRIM("settings"), ''), '{}');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ALTER COLUMN "settings" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ALTER COLUMN "settings" SET DATA TYPE jsonb USING "settings"::jsonb;--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ALTER COLUMN "settings" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ALTER COLUMN "settings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX "story_workspace_stories_author_updated_idx" ON "story_workspace_stories" USING btree ("author_id","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_workspace_updated_idx" ON "story_workspace_stories" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_status_updated_idx" ON "story_workspace_stories" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_review_updated_idx" ON "story_workspace_stories" USING btree ("review_status","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_type_updated_idx" ON "story_workspace_stories" USING btree ("type","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_stories_title_idx" ON "story_workspace_stories" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_status_updated_idx" ON "users" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "story_workspace_workspaces_owner_idx" ON "story_workspace_workspaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "story_workspace_workspaces_status_updated_idx" ON "story_workspace_workspaces" USING btree ("status","updated_at");--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_character_count_check" CHECK ("story_workspace_stories"."character_count" >= 0);--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT "story_workspace_stories_scene_count_check" CHECK ("story_workspace_stories"."scene_count" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('active', 'disabled'));--> statement-breakpoint
ALTER TABLE "story_workspace_workspaces" ADD CONSTRAINT "story_workspace_workspaces_status_check" CHECK ("story_workspace_workspaces"."status" IN ('active', 'archived'));
