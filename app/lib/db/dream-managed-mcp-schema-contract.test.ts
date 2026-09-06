// [Input] Admin-owned Dream MCP Drizzle declarations and the 0038 forward migration.
// [Output] Exact relation, security, uniqueness, index, and capability-hash evidence.
// [Pos] Provider-free schema contract test for Dream-managed MCP resources.
// [Sync] 2026-08-25: add dream.managed-mcp-resources.v1 expand contract coverage.
// [Sync] 2026-09-06: preserve the v1 base contract while allowing separately-capable additive columns.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  dream_mcp_credentials,
  dream_mcp_discovery_snapshots,
  dream_mcp_import_receipts,
  dream_mcp_servers,
} from "./schema/dream";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0038_dream_managed_mcp_resources.sql"),
  "utf8",
);

const contractLines = [
  "capability|dream.managed-mcp-resources.v1|version=1",
  "table|dream_mcp_servers",
  "columns|id:text:pk,user_id:bigint:not-null,server_key:text:not-null,display_name:text:not-null,scope_type:text:not-null,scope_id:text:nullable,transport:text:not-null,remote_url:text:nullable,stdio_profile_key:text:nullable,auth_kind:text:not-null:default-none,enabled:boolean:not-null:default-true,config_revision:integer:not-null:default-1,created_at:timestamptz:not-null:default-now,updated_at:timestamptz:not-null:default-now",
  "constraints|fk-user-users-cascade,unique-nulls-not-distinct(user_id,scope_type,scope_id,server_key),scope(user-null|workspace-nonnull),transport(streamable_http|sse|stdio),endpoint(remote-url-xor-stdio-profile),auth(none|oauth),config-revision>=1",
  "indexes|list(user_id,scope_type,scope_id,enabled,updated_at-desc)",
  "table|dream_mcp_credentials",
  "columns|id:text:pk,server_id:text:not-null,kind:text:not-null,ciphertext:text:not-null,iv:text:not-null,tag:text:not-null,fingerprint:text:not-null,key_version:integer:not-null,credential_revision:integer:not-null:default-1,expires_at:timestamptz:nullable,created_at:timestamptz:not-null:default-now,updated_at:timestamptz:not-null:default-now",
  "constraints|fk-server-cascade,unique(server_id),kind(oauth|headers|stdio_env),key-version>=1,credential-revision>=1",
  "indexes|none",
  "table|dream_mcp_discovery_snapshots",
  "columns|id:text:pk,server_id:text:not-null,config_revision:integer:not-null,credential_revision:integer:nullable,status:text:not-null,inventory:jsonb:not-null:default-object,inventory_sha256:text:not-null,safe_error_code:text:nullable,discovered_at:timestamptz:not-null:default-now,expires_at:timestamptz:not-null",
  "constraints|fk-server-cascade,unique-nulls-not-distinct(server_id,config_revision,credential_revision),config-revision>=1,credential-revision-null-or>=1,status(complete|failed|cancelled),inventory-object,inventory-sha256-lower-hex-64,expires-after-discovered",
  "indexes|query(server_id,status,expires_at-desc,discovered_at-desc)",
  "table|dream_mcp_import_receipts",
  "columns|id:text:pk,user_id:bigint:not-null,source_item_sha256:text:not-null,canonical_config_sha256:text:not-null,target_server_id:text:nullable,state:text:not-null,run_id:text:not-null,created_at:timestamptz:not-null:default-now,updated_at:timestamptz:not-null:default-now",
  "constraints|fk-user-users-cascade,fk-target-server-set-null,source-sha256-lower-hex-64,config-sha256-lower-hex-64,state(imported|noop|conflict|credential_reauth_required)",
  "indexes|unique-success-source(user_id,source_item_sha256)where-state(imported|noop),run(user_id,run_id,created_at-desc)",
] as const;

const contractSha256 = createHash("sha256")
  .update(contractLines.join("\n"), "utf8")
  .digest("hex");
const expectedContractSha256 =
  "746dfcb1343c485bee9fb7cc3fa363424db4a66ad31cd6824ed2024be049614a";

describe("Dream-managed MCP schema capability", () => {
  it("declares the exact four-relation resource boundary", () => {
    expect([
      dream_mcp_servers,
      dream_mcp_credentials,
      dream_mcp_discovery_snapshots,
      dream_mcp_import_receipts,
    ].map(getTableName)).toEqual([
      "dream_mcp_servers",
      "dream_mcp_credentials",
      "dream_mcp_discovery_snapshots",
      "dream_mcp_import_receipts",
    ]);
    expect(Object.keys(getTableColumns(dream_mcp_servers))).toEqual(expect.arrayContaining([
      "id", "user_id", "server_key", "display_name", "scope_type", "scope_id",
      "transport", "remote_url", "stdio_profile_key", "auth_kind", "enabled",
      "config_revision", "created_at", "updated_at",
    ]));
    expect(Object.keys(getTableColumns(dream_mcp_credentials))).toEqual([
      "id", "server_id", "kind", "ciphertext", "iv", "tag", "fingerprint",
      "key_version", "credential_revision", "expires_at", "created_at", "updated_at",
    ]);
    expect(Object.keys(getTableColumns(dream_mcp_discovery_snapshots))).toEqual([
      "id", "server_id", "config_revision", "credential_revision", "status",
      "inventory", "inventory_sha256", "safe_error_code", "discovered_at", "expires_at",
    ]);
    expect(Object.keys(getTableColumns(dream_mcp_import_receipts))).toEqual([
      "id", "user_id", "source_item_sha256", "canonical_config_sha256",
      "target_server_id", "state", "run_id", "created_at", "updated_at",
    ]);
  });

  it("enforces NULL-safe scope and durable successful-import uniqueness", () => {
    for (const requiredToken of [
      "fk_dream_mcp_servers_user_id_users",
      "fk_dream_mcp_credentials_server_id_servers",
      "fk_dream_mcp_discovery_snapshots_server_id_servers",
      "fk_dream_mcp_import_receipts_user_id_users",
      "fk_dream_mcp_import_receipts_target_server_id_servers",
      "uq_dream_mcp_credentials_server_id",
      "uq_dream_mcp_discovery_snapshots_revision",
      "idx_dream_mcp_servers_list",
      "idx_dream_mcp_discovery_snapshots_query",
      "idx_dream_mcp_import_receipts_run",
      "ck_dream_mcp_servers_scope",
      "ck_dream_mcp_servers_transport",
      "ck_dream_mcp_servers_endpoint",
      "ck_dream_mcp_servers_auth_kind",
      "ck_dream_mcp_servers_config_revision",
      "ck_dream_mcp_credentials_kind",
      "ck_dream_mcp_credentials_key_version",
      "ck_dream_mcp_credentials_revision",
      "ck_dream_mcp_discovery_snapshots_config_revision",
      "ck_dream_mcp_discovery_snapshots_credential_revision",
      "ck_dream_mcp_discovery_snapshots_status",
      "ck_dream_mcp_discovery_snapshots_inventory",
      "ck_dream_mcp_discovery_snapshots_inventory_sha",
      "ck_dream_mcp_discovery_snapshots_expiry",
      "ck_dream_mcp_import_receipts_source_sha",
      "ck_dream_mcp_import_receipts_config_sha",
      "ck_dream_mcp_import_receipts_state",
    ]) {
      expect(migration).toContain(requiredToken);
    }
    expect(migration).toContain(
      'CONSTRAINT "uq_dream_mcp_servers_scope_key" UNIQUE NULLS NOT DISTINCT("user_id","scope_type","scope_id","server_key")',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "uq_dream_mcp_import_receipts_success_source"',
    );
    expect(migration).toContain(
      "WHERE (state = ANY (ARRAY['imported'::text, 'noop'::text]))",
    );
    expect(migration).toContain(
      'FOREIGN KEY ("target_server_id") REFERENCES "public"."dream_mcp_servers"("id") ON DELETE set null',
    );
  });

  it("keeps credentials opaque and publishes the exact capability last", () => {
    const lastIndex = migration.lastIndexOf("CREATE INDEX");
    const capability = migration.lastIndexOf("dream.managed-mcp-resources.v1");
    expect(Object.keys(getTableColumns(dream_mcp_credentials))).not.toContain("user_id");
    expect(migration).not.toContain("plaintext");
    expect(migration).not.toContain("CREATE TRIGGER");
    expect(migration).not.toContain("admin_permissions");
    expect(migration).not.toContain("system_settings");
    expect(contractSha256).toBe(expectedContractSha256);
    expect(expectedContractSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(capability).toBeGreaterThan(lastIndex);
    expect(migration).toContain(expectedContractSha256);
  });
});
