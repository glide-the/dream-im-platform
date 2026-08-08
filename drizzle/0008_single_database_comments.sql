-- Non-destructive correction for the single-PostgreSQL architecture.
--
-- 0007 correctly deprecated the parallel Admin tables, but its comments still
-- referred to a second STORY_DATABASE_URL. Runtime access now uses one
-- DATABASE_URL, one pg.Pool and database ink-memory. This migration changes
-- comments only; it does not create, copy, update or delete business rows.

COMMENT ON TABLE "story_workspaces" IS
  'DEPRECATED parallel Admin model. Do not read or write; use public.story_workspace_workspaces through the single DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_projects" IS
  'DEPRECATED parallel Admin model. Do not read or write; use public.story_workspace_stories through the single DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_characters" IS
  'DEPRECATED parallel Admin model. Do not read or write; use public.story_workspace_characters through the single DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_scenes" IS
  'DEPRECATED parallel Admin model. Do not read or write; use public.story_workspace_scenes through the single DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_workflow_runs" IS
  'DEPRECATED parallel Admin model. Do not read or write; use public.workflow_runs through the single DATABASE_URL.';
