DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "story_workspace_stories"
    WHERE "artifact_source_type" IS NULL
      AND (
        "source_run_id" IS NOT NULL OR "source_thread_ref" IS NOT NULL
        OR "source_project_id" IS NOT NULL OR "episode_count" IS NOT NULL
        OR "artifact_status" IS NOT NULL OR "artifact_manifest_revision" IS NOT NULL
        OR "script_revision" IS NOT NULL OR "artifact_sync_status" IS NOT NULL
        OR "artifact_indexed_at" IS NOT NULL OR "artifact_sync_error_code" IS NOT NULL
        OR "script_size_bytes" IS NOT NULL OR "reconcile_version" IS NOT NULL
      )
  ) OR EXISTS (
    SELECT 1 FROM "story_workspace_stories"
    WHERE "artifact_source_type" = 'dream_episode'
      AND (
        "source_run_id" IS NULL OR "source_thread_ref" IS NULL
        OR "source_project_id" !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
        OR octet_length("source_project_id") NOT BETWEEN 1 AND 80
        OR "episode_count" NOT BETWEEN 1 AND 99
        OR "artifact_status" IS NULL OR "artifact_sync_status" IS NULL
        OR "reconcile_version" <> 1
      )
  ) OR EXISTS (
    SELECT 1 FROM "story_workspace_stories"
    WHERE "artifact_source_type" = 'dream_episode'
      AND "artifact_status" = 'available'
      AND (
        "artifact_manifest_revision" IS NULL OR "script_revision" IS NULL
        OR "script_size_bytes" IS NULL
      )
  ) OR EXISTS (
    SELECT 1 FROM "story_workspace_stories"
    WHERE "artifact_source_type" = 'dream_episode'
      AND NOT (
        ("review_status" = 'pending' AND "reviewed_script_revision" IS NULL AND "confirmed_at" IS NULL)
        OR ("review_status" = 'confirmed' AND "reviewed_script_revision" IS NOT NULL AND "confirmed_at" IS NOT NULL)
        OR ("review_status" = 'rejected' AND "reviewed_script_revision" IS NOT NULL AND "confirmed_at" IS NULL)
      )
  ) OR EXISTS (
    SELECT 1 FROM "story_workspace_stories"
    WHERE "artifact_source_type" = 'dream_episode'
      AND NOT (
        (("status" = 'published' AND "published_at" IS NOT NULL)
          OR ("status" <> 'published' AND "published_at" IS NULL))
        AND (
          "status" <> 'published' OR (
            "review_status" = 'confirmed'
            AND "reviewed_script_revision" = "script_revision"
            AND "script_revision" IS NOT NULL
            AND "artifact_status" = 'available'
            AND "artifact_sync_status" = 'indexed'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'story artifact contract conflicts detected';
  END IF;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "story_workspace_artifact_status_compatibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."artifact_source_type" = 'dream_episode' THEN
    IF NEW."artifact_status" IS NULL THEN
      NEW."artifact_status" := CASE
        WHEN NEW."artifact_available" IS TRUE THEN 'available'
        WHEN NEW."artifact_sync_status" = 'missing' THEN 'missing'
        WHEN NEW."artifact_sync_error_code" = 'story_index_invalid_artifact' THEN 'invalid'
        ELSE 'generating'
      END;
    END IF;
    IF NEW."artifact_sync_status" = 'missing' THEN
      NEW."artifact_sync_status" := 'failed';
    END IF;
    NEW."artifact_available" := NEW."artifact_status" = 'available';
  ELSE
    NEW."artifact_status" := NULL;
    NEW."artifact_available" := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "story_workspace_artifact_status_compatibility_trigger"
ON "story_workspace_stories";--> statement-breakpoint
CREATE TRIGGER "story_workspace_artifact_status_compatibility_trigger"
BEFORE INSERT OR UPDATE OF
  "artifact_source_type", "artifact_status", "artifact_available",
  "artifact_sync_status", "artifact_sync_error_code"
ON "story_workspace_stories"
FOR EACH ROW
EXECUTE FUNCTION "story_workspace_artifact_status_compatibility"();--> statement-breakpoint

ALTER TABLE "story_workspace_stories"
DROP CONSTRAINT "story_workspace_stories_artifact_sync_status_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories"
DROP CONSTRAINT "story_workspace_stories_episode_count_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories"
DROP CONSTRAINT "story_workspace_stories_reconcile_version_check";--> statement-breakpoint

ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_artifact_sync_status_check"
CHECK ("artifact_sync_status" IS NULL OR "artifact_sync_status" IN ('syncing', 'indexed', 'stale', 'failed')) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_episode_count_check"
CHECK ("episode_count" IS NULL OR "episode_count" BETWEEN 1 AND 99) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_reconcile_version_check"
CHECK ("reconcile_version" IS NULL OR "reconcile_version" = 1) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_artifact_identity_check"
CHECK (
  (
    "artifact_source_type" IS NULL
    AND "source_run_id" IS NULL AND "source_thread_ref" IS NULL
    AND "source_project_id" IS NULL AND "episode_count" IS NULL
    AND "artifact_status" IS NULL AND "artifact_manifest_revision" IS NULL
    AND "script_revision" IS NULL AND "artifact_sync_status" IS NULL
    AND "artifact_indexed_at" IS NULL AND "artifact_sync_error_code" IS NULL
    AND "script_size_bytes" IS NULL AND "reconcile_version" IS NULL
  ) OR (
    "artifact_source_type" = 'dream_episode'
    AND "source_run_id" IS NOT NULL AND "source_thread_ref" IS NOT NULL
    AND "source_project_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND octet_length("source_project_id") BETWEEN 1 AND 80
    AND "episode_count" BETWEEN 1 AND 99
    AND "artifact_status" IS NOT NULL AND "artifact_sync_status" IS NOT NULL
    AND "reconcile_version" = 1
  )
) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_artifact_revision_state_check"
CHECK (
  "artifact_source_type" IS NULL OR "artifact_status" <> 'available'
  OR (
    "artifact_manifest_revision" IS NOT NULL AND "script_revision" IS NOT NULL
    AND "script_size_bytes" IS NOT NULL
  )
) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_review_integrity_check"
CHECK (
  "artifact_source_type" IS NULL OR (
    ("review_status" = 'pending' AND "reviewed_script_revision" IS NULL AND "confirmed_at" IS NULL)
    OR ("review_status" = 'confirmed' AND "reviewed_script_revision" IS NOT NULL AND "confirmed_at" IS NOT NULL)
    OR ("review_status" = 'rejected' AND "reviewed_script_revision" IS NOT NULL AND "confirmed_at" IS NULL)
  )
) NOT VALID;--> statement-breakpoint
ALTER TABLE "story_workspace_stories" ADD CONSTRAINT
"story_workspace_stories_business_review_check"
CHECK (
  "artifact_source_type" IS NULL OR (
    (("status" = 'published' AND "published_at" IS NOT NULL)
      OR ("status" <> 'published' AND "published_at" IS NULL))
    AND (
      "status" <> 'published' OR (
        "review_status" = 'confirmed'
        AND "reviewed_script_revision" = "script_revision"
        AND "script_revision" IS NOT NULL
        AND "artifact_status" = 'available'
        AND "artifact_sync_status" = 'indexed'
      )
    )
  )
) NOT VALID;--> statement-breakpoint

ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_artifact_sync_status_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_episode_count_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_reconcile_version_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_artifact_identity_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_artifact_revision_state_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_review_integrity_check";--> statement-breakpoint
ALTER TABLE "story_workspace_stories" VALIDATE CONSTRAINT "story_workspace_stories_business_review_check";
