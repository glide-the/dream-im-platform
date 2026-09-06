-- [Input] Admin-owned Dream MCP Server rows and connection-level user App preferences.
-- [Output] Deny-by-default desired switches, an independent CAS revision, and exact capability metadata.
-- [Pos] Sole forward PostgreSQL owner for dream.mcp-app-connection-settings.v1.
-- [Sync] 2026-09-06: generated and reviewed additive connection-level MCP App settings.

ALTER TABLE "dream_mcp_servers" ADD COLUMN "app_desired_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dream_mcp_servers" ADD COLUMN "app_desired_low_risk_tool_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dream_mcp_servers" ADD COLUMN "app_desired_ui_messages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dream_mcp_servers" ADD COLUMN "app_settings_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dream_mcp_servers" ADD CONSTRAINT "ck_dream_mcp_servers_app_settings_revision" CHECK (app_settings_revision >= 1);--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.mcp-app-connection-settings.v1',
  1,
  'c8a1daebd20db54890ca31bf154faad4bd6f2714c609dba413acca88e2139202',
  'admin-drizzle-0053',
  '{"defaultEnabled":false,"independentRevision":true,"serverManagedDeployment":true,"userDesiredOnly":true}'::jsonb
);
