-- Non-destructive compatibility migration.
--
-- These five tables were introduced by 0006 before the source-domain audit.
-- They do not match ink-dream-memory and are no longer referenced by Admin
-- resources, APIs, dashboard queries, or the canonical Drizzle schema. Keep
-- the physical tables intact until an operator has proved that they are empty
-- and has approved a separate, reversible retirement migration.

COMMENT ON TABLE "story_workspaces" IS
  'DEPRECATED parallel Admin model. Do not read or write; use story_workspace_workspaces through STORY_DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_projects" IS
  'DEPRECATED parallel Admin model. Do not read or write; use story_workspace_stories through STORY_DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_characters" IS
  'DEPRECATED parallel Admin model. Do not read or write; use story_workspace_characters through STORY_DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_scenes" IS
  'DEPRECATED parallel Admin model. Do not read or write; use story_workspace_scenes through STORY_DATABASE_URL.';
--> statement-breakpoint
COMMENT ON TABLE "story_workflow_runs" IS
  'DEPRECATED parallel Admin model. Do not read or write; use workflow_runs through STORY_DATABASE_URL.';
