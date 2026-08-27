// [Input] Claude Agent resource snapshot Drizzle declaration, 0040 migration, snapshot, and journal.
// [Output] Exact additive relation/index, time/JSON guards, and capability publication evidence.
// [Pos] Provider-free schema contract for dream.claude-agent-resource-observer.v1.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { claude_agent_resource_snapshots } from "./schema/dream";

const migrationPath = resolve(process.cwd(), "drizzle/0040_claude_agent_resource_observer.sql");
const migration = readFileSync(migrationPath, "utf8");
const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/0040_snapshot.json"), "utf8"));
const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
const capability = "dream.claude-agent-resource-observer.v1";
const contractLines = [
  "capability|dream.claude-agent-resource-observer.v1",
  "version|1",
  "table|public.claude_agent_resource_snapshots",
  "columns|instance_id:text:pk,process_started_at:timestamptz:not-null,heartbeat_at:timestamptz:not-null:db-clock,sampled_at:timestamptz:nullable:db-clock,snapshot:jsonb:not-null,created_at:timestamptz:not-null:default-now,updated_at:timestamptz:not-null:default-now",
  "snapshot|schema_version:1,content-free:true,latest-instance:true,process-lifetime-counters:true",
  "policy|system_settings:claude_agent/resource_policy:schemaVersion=1:desired-effective",
];
const contractSha256 = createHash("sha256").update(contractLines.join("\n")).digest("hex");
const expectedContractSha256 = "db2ba80eb61a9515ba23000f8a615fb41f6ed5824bd306e8d0ca5fb8f1cc044e";

describe("Claude Agent resource observer schema capability", () => {
  it("declares the exact latest-instance relation", () => {
    expect(getTableName(claude_agent_resource_snapshots)).toBe("claude_agent_resource_snapshots");
    expect(Object.keys(getTableColumns(claude_agent_resource_snapshots))).toEqual([
      "instance_id",
      "process_started_at",
      "heartbeat_at",
      "sampled_at",
      "snapshot",
      "created_at",
      "updated_at",
    ]);
    expect(snapshot.tables["public.claude_agent_resource_snapshots"]).toBeDefined();
  });

  it("keeps the migration additive and guards identity, JSON, and timestamps", () => {
    for (const token of [
      "idx_claude_agent_resource_snapshots_heartbeat",
      'USING btree ("heartbeat_at" DESC NULLS LAST)',
      "ck_claude_agent_resource_snapshots_instance_id",
      "ck_claude_agent_resource_snapshots_snapshot",
      "ck_claude_agent_resource_snapshots_heartbeat",
      "ck_claude_agent_resource_snapshots_sampled",
      "ck_claude_agent_resource_snapshots_updated",
      "jsonb_typeof(snapshot) = 'object'::text",
      "heartbeat_at >= process_started_at",
    ]) {
      expect(migration).toContain(token);
    }
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|ALTER\s+COLUMN|CREATE\s+TRIGGER)\b/i);
    expect(migration).not.toContain("system_settings");
    expect(migration).not.toContain("admin_permissions");
  });

  it("publishes the exact capability after all DDL and records 0040 in the journal", () => {
    expect(contractSha256).toBe(expectedContractSha256);
    expect(migration).toContain("'dream.claude-agent-resource-observer.v1'");
    expect(migration).toContain("'admin-drizzle-0040'");
    expect(migration).toContain(`'${contractSha256}'`);
    expect(migration.lastIndexOf(capability)).toBeGreaterThan(migration.lastIndexOf("CREATE INDEX"));
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 40,
      tag: "0040_claude_agent_resource_observer",
      version: "7",
    });
  });
});
