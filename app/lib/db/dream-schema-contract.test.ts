// [Input] Complete Admin-owned Dream Drizzle schema export.
// [Output] Count evidence that canonical and Dream tables remain fully declared.
// [Pos] Shared PostgreSQL schema inventory contract test.
// [Sync] 2026-08-19: include five ClaudePlugin Remote Marketplace relations.

import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as dreamSchema from "./schema/dream";
import {
  storyWorkspaceStories,
  storyWorkspaceWorkspaces,
  users,
} from "./schema";

describe("complete Dream Drizzle schema", () => {
  it("declares exactly 54 Dream and canonical baseline tables", () => {
    const generatedNames = Object.values(dreamSchema)
      .filter(isTable)
      .map(getTableName);
    const allNames = [
      ...generatedNames,
      getTableName(users),
      getTableName(storyWorkspaceWorkspaces),
      getTableName(storyWorkspaceStories),
    ];

    expect(generatedNames).toHaveLength(51);
    expect(new Set(allNames).size).toBe(54);
  });
});
