import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as dreamSchema from "./schema/dream";
import {
  storyWorkspaceStories,
  storyWorkspaceWorkspaces,
  users,
} from "./schema";

describe("complete Dream Drizzle schema", () => {
  it("declares exactly 45 domain tables plus the three canonical baseline tables", () => {
    const generatedNames = Object.values(dreamSchema)
      .filter(isTable)
      .map(getTableName);
    const allNames = [
      ...generatedNames,
      getTableName(users),
      getTableName(storyWorkspaceWorkspaces),
      getTableName(storyWorkspaceStories),
    ];

    expect(generatedNames).toHaveLength(45);
    expect(new Set(allNames).size).toBe(48);
  });
});
