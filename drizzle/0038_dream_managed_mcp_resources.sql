-- [Input] Admin-owned Dream MCP resource schema and exact cross-service contract.
-- [Output] Four normalized MCP relations, credential secrecy boundaries, durable import uniqueness, and capability metadata.
-- [Pos] Sole forward PostgreSQL DDL owner for dream.managed-mcp-resources.v1.
-- [Sync] 2026-08-25: generated 0038, reviewed constraints/indexes, and published the final contract hash last.

CREATE TABLE "dream_mcp_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"tag" text NOT NULL,
	"fingerprint" text NOT NULL,
	"key_version" integer NOT NULL,
	"credential_revision" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dream_mcp_credentials_server_id" UNIQUE("server_id"),
	CONSTRAINT "ck_dream_mcp_credentials_kind" CHECK (kind = ANY (ARRAY['oauth'::text, 'headers'::text, 'stdio_env'::text])),
	CONSTRAINT "ck_dream_mcp_credentials_key_version" CHECK (key_version >= 1),
	CONSTRAINT "ck_dream_mcp_credentials_revision" CHECK (credential_revision >= 1)
);
--> statement-breakpoint
CREATE TABLE "dream_mcp_discovery_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"config_revision" integer NOT NULL,
	"credential_revision" integer,
	"status" text NOT NULL,
	"inventory" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inventory_sha256" text NOT NULL,
	"safe_error_code" text,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uq_dream_mcp_discovery_snapshots_revision" UNIQUE NULLS NOT DISTINCT("server_id","config_revision","credential_revision"),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_config_revision" CHECK (config_revision >= 1),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_credential_revision" CHECK (credential_revision IS NULL OR credential_revision >= 1),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_status" CHECK (status = ANY (ARRAY['complete'::text, 'failed'::text, 'cancelled'::text])),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_inventory" CHECK (jsonb_typeof(inventory) = 'object'::text),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_inventory_sha" CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_dream_mcp_discovery_snapshots_expiry" CHECK (expires_at > discovered_at)
);
--> statement-breakpoint
CREATE TABLE "dream_mcp_import_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"source_item_sha256" text NOT NULL,
	"canonical_config_sha256" text NOT NULL,
	"target_server_id" text,
	"state" text NOT NULL,
	"run_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_dream_mcp_import_receipts_source_sha" CHECK (source_item_sha256 ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_dream_mcp_import_receipts_config_sha" CHECK (canonical_config_sha256 ~ '^[0-9a-f]{64}$'::text),
	CONSTRAINT "ck_dream_mcp_import_receipts_state" CHECK (state = ANY (ARRAY['imported'::text, 'noop'::text, 'conflict'::text, 'credential_reauth_required'::text]))
);
--> statement-breakpoint
CREATE TABLE "dream_mcp_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"server_key" text NOT NULL,
	"display_name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"transport" text NOT NULL,
	"remote_url" text,
	"stdio_profile_key" text,
	"auth_kind" text DEFAULT 'none' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config_revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dream_mcp_servers_scope_key" UNIQUE NULLS NOT DISTINCT("user_id","scope_type","scope_id","server_key"),
	CONSTRAINT "ck_dream_mcp_servers_scope" CHECK ((scope_type = 'user'::text AND scope_id IS NULL) OR (scope_type = 'workspace'::text AND scope_id IS NOT NULL)),
	CONSTRAINT "ck_dream_mcp_servers_transport" CHECK (transport = ANY (ARRAY['streamable_http'::text, 'sse'::text, 'stdio'::text])),
	CONSTRAINT "ck_dream_mcp_servers_endpoint" CHECK (((transport = ANY (ARRAY['streamable_http'::text, 'sse'::text])) AND remote_url IS NOT NULL AND stdio_profile_key IS NULL) OR (transport = 'stdio'::text AND remote_url IS NULL AND stdio_profile_key IS NOT NULL)),
	CONSTRAINT "ck_dream_mcp_servers_auth_kind" CHECK (auth_kind = ANY (ARRAY['none'::text, 'oauth'::text])),
	CONSTRAINT "ck_dream_mcp_servers_config_revision" CHECK (config_revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "dream_mcp_credentials" ADD CONSTRAINT "fk_dream_mcp_credentials_server_id_servers" FOREIGN KEY ("server_id") REFERENCES "public"."dream_mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_mcp_discovery_snapshots" ADD CONSTRAINT "fk_dream_mcp_discovery_snapshots_server_id_servers" FOREIGN KEY ("server_id") REFERENCES "public"."dream_mcp_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_mcp_import_receipts" ADD CONSTRAINT "fk_dream_mcp_import_receipts_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_mcp_import_receipts" ADD CONSTRAINT "fk_dream_mcp_import_receipts_target_server_id_servers" FOREIGN KEY ("target_server_id") REFERENCES "public"."dream_mcp_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dream_mcp_servers" ADD CONSTRAINT "fk_dream_mcp_servers_user_id_users" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dream_mcp_discovery_snapshots_query" ON "dream_mcp_discovery_snapshots" USING btree ("server_id" text_ops,"status" text_ops,"expires_at" timestamptz_ops,"discovered_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dream_mcp_import_receipts_success_source" ON "dream_mcp_import_receipts" USING btree ("user_id" int8_ops,"source_item_sha256" text_ops) WHERE (state = ANY (ARRAY['imported'::text, 'noop'::text]));--> statement-breakpoint
CREATE INDEX "idx_dream_mcp_import_receipts_run" ON "dream_mcp_import_receipts" USING btree ("user_id" int8_ops,"run_id" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_dream_mcp_servers_list" ON "dream_mcp_servers" USING btree ("user_id" int8_ops,"scope_type" text_ops,"scope_id" text_ops,"enabled" bool_ops,"updated_at" timestamptz_ops);--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.managed-mcp-resources.v1',
  1,
  '746dfcb1343c485bee9fb7cc3fa363424db4a66ad31cd6824ed2024be049614a',
  'admin-drizzle-0038',
  '{"credentialPlaintext":false,"credentialUserDuplication":false,"durableImportFingerprint":true,"nullSafeScopeIdentity":true,"tables":["dream_mcp_servers","dream_mcp_credentials","dream_mcp_discovery_snapshots","dream_mcp_import_receipts"]}'::jsonb
);
