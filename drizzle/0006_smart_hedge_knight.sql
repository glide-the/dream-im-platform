CREATE TABLE "story_characters" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"role_type" text DEFAULT 'supporting' NOT NULL,
	"description" text,
	"profile" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_characters_sort_check" CHECK ("story_characters"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "story_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"synopsis" text,
	"story_type" text DEFAULT 'screenplay' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"scene_count" integer DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"agent_generated" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_projects_counts_check" CHECK ("story_projects"."character_count" >= 0 AND "story_projects"."scene_count" >= 0 AND "story_projects"."word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "story_scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_scenes_counts_check" CHECK ("story_scenes"."sort_order" >= 0 AND "story_scenes"."word_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "story_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"created_by_user_id" text NOT NULL,
	"workflow_code" text NOT NULL,
	"workflow_version" text DEFAULT '1' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"failed_step" text,
	"error_code" text,
	"error_message" text,
	"input" jsonb DEFAULT '{}'::jsonb,
	"output" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "conversations" CASCADE;--> statement-breakpoint
DROP TABLE "customers" CASCADE;--> statement-breakpoint
DROP TABLE "system_configs" CASCADE;--> statement-breakpoint
DROP TABLE "todos" CASCADE;--> statement-breakpoint
ALTER TABLE "story_characters" ADD CONSTRAINT "story_characters_project_id_story_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."story_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_projects" ADD CONSTRAINT "story_projects_workspace_id_story_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."story_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_projects" ADD CONSTRAINT "story_projects_owner_user_id_platform_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_project_id_story_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."story_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workflow_runs" ADD CONSTRAINT "story_workflow_runs_workspace_id_story_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."story_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workflow_runs" ADD CONSTRAINT "story_workflow_runs_project_id_story_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."story_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workflow_runs" ADD CONSTRAINT "story_workflow_runs_created_by_user_id_platform_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_workspaces" ADD CONSTRAINT "story_workspaces_owner_user_id_platform_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_characters_project_idx" ON "story_characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_characters_status_idx" ON "story_characters" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "story_projects_identifier_uidx" ON "story_projects" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "story_projects_workspace_idx" ON "story_projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "story_projects_owner_idx" ON "story_projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "story_projects_status_idx" ON "story_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "story_projects_updated_idx" ON "story_projects" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "story_scenes_project_idx" ON "story_scenes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_scenes_status_idx" ON "story_scenes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "story_workflow_runs_workspace_idx" ON "story_workflow_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "story_workflow_runs_project_idx" ON "story_workflow_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "story_workflow_runs_status_idx" ON "story_workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "story_workflow_runs_created_idx" ON "story_workflow_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "story_workspaces_slug_uidx" ON "story_workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "story_workspaces_owner_idx" ON "story_workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "story_workspaces_status_idx" ON "story_workspaces" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "system_settings_category_key_uidx" ON "system_settings" USING btree ("category","key");--> statement-breakpoint
CREATE INDEX "system_settings_status_idx" ON "system_settings" USING btree ("status");
--> statement-breakpoint
INSERT INTO "admin_permissions" ("id", "code", "name") VALUES
  ('perm_story_write', 'story.write', 'story.write'),
  ('perm_system_read', 'system.read', 'system.read'),
  ('perm_system_write', 'system.write', 'system.write')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "admin_roles" r
CROSS JOIN "admin_permissions" p
WHERE
  (r."code" = 'super_admin' AND p."code" IN ('story.write', 'system.read', 'system.write'))
  OR (r."code" = 'operator' AND p."code" IN ('story.write', 'system.read', 'system.write'))
  OR (r."code" = 'auditor' AND p."code" = 'system.read')
ON CONFLICT DO NOTHING;
