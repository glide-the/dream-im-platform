// [Input] Admin Drizzle Marketplace schema and the 0037 forward migration.
// [Output] Evidence for five global relations, exact plugin digests, single-run synchronization, install lineage, immutable snapshots, permission, and capability ordering.
// [Pos] Shared PostgreSQL ClaudePlugin Remote Marketplace schema contract test.
// [Sync] 2026-08-19: add dream.claude-plugin.remote-marketplace.v1 expand contract.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  claude_plugin_installations,
  claude_plugin_marketplace_entries,
  claude_plugin_marketplace_entry_policies,
  claude_plugin_marketplace_revisions,
  claude_plugin_marketplace_sync_runs,
  claude_plugin_marketplaces,
  claude_plugin_operations,
} from "./schema/dream";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0037_claude_plugin_remote_marketplace.sql"),
  "utf8",
);

describe("ClaudePlugin Remote Marketplace schema capability", () => {
  it("declares one global catalog with immutable revisions and install lineage", () => {
    expect([
      claude_plugin_marketplaces,
      claude_plugin_marketplace_sync_runs,
      claude_plugin_marketplace_revisions,
      claude_plugin_marketplace_entries,
      claude_plugin_marketplace_entry_policies,
    ].map(getTableName)).toEqual([
      "claude_plugin_marketplaces",
      "claude_plugin_marketplace_sync_runs",
      "claude_plugin_marketplace_revisions",
      "claude_plugin_marketplace_entries",
      "claude_plugin_marketplace_entry_policies",
    ]);
    expect(Object.keys(getTableColumns(claude_plugin_operations))).toContain("marketplace_entry_id");
    expect(Object.keys(getTableColumns(claude_plugin_installations))).toContain("marketplace_entry_id");
    expect(Object.keys(getTableColumns(claude_plugin_marketplace_entries))).toContain("plugin_digest");
    expect(migration).toContain("uq_claude_plugin_marketplace_sync_runs_running");
    expect(migration).toContain("ck_claude_plugin_marketplace_entries_valid_digest");
  });

  it("publishes permission and capability after immutable snapshot guards", () => {
    const revisionTrigger = migration.indexOf("claude_plugin_marketplace_revisions_no_update");
    const entryTrigger = migration.indexOf("claude_plugin_marketplace_entries_no_update");
    const permission = migration.indexOf("claude_plugin_marketplaces.manage");
    const capability = migration.indexOf("dream.claude-plugin.remote-marketplace.v1");
    expect(revisionTrigger).toBeGreaterThan(0);
    expect(entryTrigger).toBeGreaterThan(revisionTrigger);
    expect(permission).toBeGreaterThan(entryTrigger);
    expect(capability).toBeGreaterThan(permission);
    expect(migration).toContain("CLAUDE_PLUGIN_MARKETPLACE_SNAPSHOT_IMMUTABLE");
    expect(migration).toContain("d215cb2764f656ab32e364a4900b3aac73fca60c77ef4c9f3a914fd192a8c314");
  });
});
