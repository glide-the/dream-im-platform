// [Sync] 2026-09-27: include the additive task-result relation.
// [Sync] 2026-10-05: inventory includes the already published 0069 scheduled task and trigger relations.
// [Sync] 2026-09-26: include the additive durable Chat input queue relation.
// [Input] Complete Admin-owned Dream Drizzle schema export.
// [Output] Exact count and classification evidence that canonical and Dream tables remain fully declared.
// [Pos] Shared PostgreSQL schema inventory contract test.
// [Sync] 2026-08-19: include five ClaudePlugin Remote Marketplace relations.
// [Sync] 2026-08-25: include four Admin-owned Dream-managed MCP relations.
// [Sync] 2026-08-27: include the Claude Agent latest-instance resource snapshot relation.
// [Sync] 2026-09-15: include the 0061 Reflections task-section relation explicitly.

import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as dreamSchema from "./schema/dream";
import {
  storyWorkspaceStories,
  storyWorkspaceWorkspaces,
  users,
} from "./schema";

describe("complete Dream Drizzle schema", () => {
  it("declares exactly 65 Dream and canonical baseline tables", () => {
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

    expect(generatedNames).toHaveLength(62);
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
    expect(generatedNames).toContain("claude_agent_resource_snapshots");
    expect(generatedNames).toContain("reflection_task_section");
    expect(generatedNames).toContain("chat_input_queue");
    expect(generatedNames).toContain("chat_task_session");
    expect(generatedNames).toContain("chat_task_result");
    expect(generatedNames).toContain("chat_scheduled_task");
    expect(generatedNames).toContain("chat_scheduled_trigger");
    expect(allNames).toHaveLength(65);
    expect(new Set(allNames).size).toBe(65);
  });
});
