-- [Input] Admin Drizzle schema diff for the platform-global ClaudePlugin Remote Marketplace capability.
-- [Output] Five global relations, immutable revisions/entries, digest/sync guards, install lineage, RBAC, and capability metadata.
-- [Pos] Sole forward PostgreSQL DDL owner for Dream/Admin Remote Marketplace v1.
-- [Sync] 2026-08-19: generated 0037 plus reviewed immutable, permission, and exact capability statements.

CREATE TABLE "claude_plugin_marketplace_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"package_name" text NOT NULL,
	"marketplace_name" text NOT NULL,
	"package_spec" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"version" text,
	"homepage" text,
	"source_path" text NOT NULL,
	"source_json" jsonb NOT NULL,
	"plugin_manifest_json" jsonb,
	"plugin_manifest_sha256" text,
	"plugin_digest" text,
	"component_inventory_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"compatibility_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" text NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_claude_plugin_marketplace_entries_revision_package" UNIQUE("revision_id","package_name"),
	CONSTRAINT "uq_claude_plugin_marketplace_entries_identity" UNIQUE("id","marketplace_id","package_name"),
	CONSTRAINT "ck_claude_plugin_marketplace_entries_plugin_manifest_sha" CHECK (plugin_manifest_sha256 IS NULL OR plugin_manifest_sha256 ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_claude_plugin_marketplace_entries_plugin_digest" CHECK (plugin_digest IS NULL OR plugin_digest ~ '^sha256:[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_claude_plugin_marketplace_entries_valid_digest" CHECK (validation_status <> 'valid'::text OR plugin_digest IS NOT NULL),
	CONSTRAINT "ck_claude_plugin_marketplace_entries_status" CHECK (validation_status = ANY (ARRAY['valid'::text, 'invalid'::text]))
);
--> statement-breakpoint
CREATE TABLE "claude_plugin_marketplace_entry_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"package_name" text NOT NULL,
	"decision" text DEFAULT 'blocked' NOT NULL,
	"approved_entry_id" text,
	"reason" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_claude_plugin_marketplace_entry_policies_package" UNIQUE("marketplace_id","package_name"),
	CONSTRAINT "ck_claude_plugin_marketplace_entry_policies_decision" CHECK (decision = ANY (ARRAY['approved'::text, 'blocked'::text])),
	CONSTRAINT "ck_claude_plugin_marketplace_entry_policies_approval" CHECK ((decision = 'approved'::text AND approved_entry_id IS NOT NULL) OR (decision = 'blocked'::text AND approved_entry_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "claude_plugin_marketplace_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"sync_run_id" text NOT NULL,
	"remote_url" text NOT NULL,
	"requested_ref" text,
	"resolved_commit_sha" text NOT NULL,
	"marketplace_name" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"entry_count" integer NOT NULL,
	"validation_status" text NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_claude_plugin_marketplace_revisions_marketplace_commit" UNIQUE("marketplace_id","resolved_commit_sha"),
	CONSTRAINT "uq_claude_plugin_marketplace_revisions_sync_run" UNIQUE("sync_run_id"),
	CONSTRAINT "ck_claude_plugin_marketplace_revisions_commit_sha" CHECK (resolved_commit_sha ~ '^[0-9a-f]{40}$'::text),
	CONSTRAINT "ck_claude_plugin_marketplace_revisions_manifest_sha" CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_claude_plugin_marketplace_revisions_entry_count" CHECK (entry_count >= 0),
	CONSTRAINT "ck_claude_plugin_marketplace_revisions_status" CHECK (validation_status = ANY (ARRAY['valid'::text, 'invalid'::text]))
);
--> statement-breakpoint
CREATE TABLE "claude_plugin_marketplace_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"marketplace_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"requested_ref" text,
	"resolved_commit_sha" text,
	"requested_by" text NOT NULL,
	"error_code" text,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_claude_plugin_marketplace_sync_runs_status" CHECK (status = ANY (ARRAY['running'::text, 'succeeded'::text, 'failed'::text]))
);
--> statement-breakpoint
CREATE TABLE "claude_plugin_marketplaces" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"remote_url" text NOT NULL,
	"default_ref" text,
	"marketplace_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_sync_error_code" text,
	"last_sync_error_summary" text,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_claude_plugin_marketplaces_status" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'disabled'::text, 'error'::text]))
);
--> statement-breakpoint
ALTER TABLE "claude_plugin_installations" ADD COLUMN "marketplace_entry_id" text;--> statement-breakpoint
ALTER TABLE "claude_plugin_operations" ADD COLUMN "marketplace_entry_id" text;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_entries" ADD CONSTRAINT "fk_claude_plugin_marketplace_entries_marketplace" FOREIGN KEY ("marketplace_id") REFERENCES "public"."claude_plugin_marketplaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_entries" ADD CONSTRAINT "fk_claude_plugin_marketplace_entries_revision" FOREIGN KEY ("revision_id") REFERENCES "public"."claude_plugin_marketplace_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_entry_policies" ADD CONSTRAINT "fk_claude_plugin_marketplace_entry_policies_marketplace" FOREIGN KEY ("marketplace_id") REFERENCES "public"."claude_plugin_marketplaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_entry_policies" ADD CONSTRAINT "fk_claude_plugin_marketplace_entry_policies_approved_entry" FOREIGN KEY ("approved_entry_id","marketplace_id","package_name") REFERENCES "public"."claude_plugin_marketplace_entries"("id","marketplace_id","package_name") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_revisions" ADD CONSTRAINT "fk_claude_plugin_marketplace_revisions_marketplace" FOREIGN KEY ("marketplace_id") REFERENCES "public"."claude_plugin_marketplaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_revisions" ADD CONSTRAINT "fk_claude_plugin_marketplace_revisions_sync_run" FOREIGN KEY ("sync_run_id") REFERENCES "public"."claude_plugin_marketplace_sync_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_marketplace_sync_runs" ADD CONSTRAINT "fk_claude_plugin_marketplace_sync_runs_marketplace" FOREIGN KEY ("marketplace_id") REFERENCES "public"."claude_plugin_marketplaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_entries_marketplace_package" ON "claude_plugin_marketplace_entries" USING btree ("marketplace_id" text_ops,"package_name" text_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_entries_revision" ON "claude_plugin_marketplace_entries" USING btree ("revision_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_entry_policies_decision" ON "claude_plugin_marketplace_entry_policies" USING btree ("decision" text_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_revisions_marketplace" ON "claude_plugin_marketplace_revisions" USING btree ("marketplace_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_sync_runs_marketplace" ON "claude_plugin_marketplace_sync_runs" USING btree ("marketplace_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplace_sync_runs_status" ON "claude_plugin_marketplace_sync_runs" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_claude_plugin_marketplace_sync_runs_running" ON "claude_plugin_marketplace_sync_runs" USING btree ("marketplace_id" text_ops) WHERE (status = 'running'::text);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_claude_plugin_marketplaces_slug" ON "claude_plugin_marketplaces" USING btree ("slug" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_claude_plugin_marketplaces_remote_url" ON "claude_plugin_marketplaces" USING btree ("remote_url" text_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_marketplaces_status" ON "claude_plugin_marketplaces" USING btree ("status" text_ops);--> statement-breakpoint
ALTER TABLE "claude_plugin_installations" ADD CONSTRAINT "fk_claude_plugin_installations_marketplace_entry" FOREIGN KEY ("marketplace_entry_id") REFERENCES "public"."claude_plugin_marketplace_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_plugin_operations" ADD CONSTRAINT "fk_claude_plugin_operations_marketplace_entry" FOREIGN KEY ("marketplace_entry_id") REFERENCES "public"."claude_plugin_marketplace_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_installations_marketplace_entry" ON "claude_plugin_installations" USING btree ("marketplace_entry_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_claude_plugin_operations_marketplace_entry" ON "claude_plugin_operations" USING btree ("marketplace_entry_id" text_ops);--> statement-breakpoint
CREATE OR REPLACE FUNCTION dream_guard_claude_plugin_marketplace_snapshot_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $claude_plugin_marketplace_snapshot_immutable$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'CLAUDE_PLUGIN_MARKETPLACE_SNAPSHOT_IMMUTABLE';
END
$claude_plugin_marketplace_snapshot_immutable$;--> statement-breakpoint
CREATE TRIGGER claude_plugin_marketplace_revisions_no_update
BEFORE UPDATE OR DELETE ON claude_plugin_marketplace_revisions
FOR EACH ROW EXECUTE FUNCTION dream_guard_claude_plugin_marketplace_snapshot_immutable();--> statement-breakpoint
CREATE TRIGGER claude_plugin_marketplace_entries_no_update
BEFORE UPDATE OR DELETE ON claude_plugin_marketplace_entries
FOR EACH ROW EXECUTE FUNCTION dream_guard_claude_plugin_marketplace_snapshot_immutable();--> statement-breakpoint
INSERT INTO "admin_permissions" ("id", "code", "name", "description")
VALUES (
  'permission_claude_plugin_marketplaces_manage',
  'claude_plugin_marketplaces.manage',
  'Manage ClaudePlugin marketplaces',
  'Create, synchronize, enable, disable, approve and block global ClaudePlugin remote Marketplace entries'
);--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "admin_roles" AS role
JOIN "admin_permissions" AS permission
  ON permission."code" = 'claude_plugin_marketplaces.manage'
WHERE role."code" IN ('super_admin', 'operator');--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.claude-plugin.remote-marketplace.v1',
  1,
  'd215cb2764f656ab32e364a4900b3aac73fca60c77ef4c9f3a914fd192a8c314',
  'admin-drizzle-0037',
  '{"globalCatalog":true,"installLineage":true,"marketplaceObjectStorage":false,"pluginDigest":true,"singleRunningSync":true,"tables":["claude_plugin_marketplaces","claude_plugin_marketplace_sync_runs","claude_plugin_marketplace_revisions","claude_plugin_marketplace_entries","claude_plugin_marketplace_entry_policies"]}'::jsonb
);
