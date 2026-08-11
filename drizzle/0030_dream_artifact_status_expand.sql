ALTER TABLE "story_workspace_stories"
ADD COLUMN IF NOT EXISTS "artifact_status" text;--> statement-breakpoint

UPDATE "story_workspace_stories"
SET "artifact_status" = CASE
  WHEN "artifact_available" IS TRUE THEN 'available'
  WHEN "artifact_sync_status" = 'missing' THEN 'missing'
  WHEN "artifact_sync_error_code" = 'story_index_invalid_artifact' THEN 'invalid'
  ELSE 'generating'
END
WHERE "artifact_source_type" = 'dream_episode'
  AND "artifact_status" IS NULL;--> statement-breakpoint

ALTER TABLE "story_workspace_stories"
ADD CONSTRAINT "story_workspace_stories_artifact_status_check"
CHECK (
  "artifact_status" IS NULL
  OR "artifact_status" IN ('generating', 'available', 'missing', 'invalid')
) NOT VALID;--> statement-breakpoint

ALTER TABLE "story_workspace_stories"
VALIDATE CONSTRAINT "story_workspace_stories_artifact_status_check";
