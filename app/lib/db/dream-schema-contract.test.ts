// [Input] Complete Admin-owned Dream Drizzle schema export.
// [Output] Exact count and classification evidence that canonical and Dream tables remain fully declared.
// [Pos] Shared PostgreSQL schema inventory contract test.
// [Sync] 2026-08-19: include five ClaudePlugin Remote Marketplace relations.
// [Sync] 2026-08-25: include four Admin-owned Dream-managed MCP relations.

import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as dreamSchema from "./schema/dream";
import {
  storyWorkspaceStories,
  storyWorkspaceWorkspaces,
  users,
} from "./schema";

describe("complete Dream Drizzle schema", () => {
  it("declares exactly 58 Dream and canonical baseline tables", () => {
    const generatedNames = Object.values(dreamSchema)
      .filter(isTable)
      .map(getTableName);
    const canonicalBaselineNames = [
      getTableName(users),
      getTableName(storyWorkspaceWorkspaces),
      getTableName(storyWorkspaceStories),
    ];
    const managedMcpNames = generatedNames.filter((name) =>
      name.startsWith("dream_mcp_"),
    );
    const allNames = [...generatedNames, ...canonicalBaselineNames];

    expect(generatedNames).toHaveLength(55);
    expect(managedMcpNames).toEqual([
      "dream_mcp_servers",
      "dream_mcp_credentials",
      "dream_mcp_discovery_snapshots",
      "dream_mcp_import_receipts",
    ]);
    expect(canonicalBaselineNames).toEqual([
      "users",
      "story_workspace_workspaces",
      "story_workspace_stories",
    ]);
    expect(allNames).toHaveLength(58);
    expect(new Set(allNames).size).toBe(58);
  });
});
