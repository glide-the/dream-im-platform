import { describe, expect, it } from "vitest";

import {
  fingerprintIds,
  parseSafeTargetUrl,
  validateSourceRows,
} from "../../scripts/lib/story-source-import.mjs";

describe("Story source import safety", () => {
  it("accepts only an isolated PostgreSQL ink-memory target", () => {
    expect(parseSafeTargetUrl("postgres://test:test@127.0.0.1:55432/ink-memory").port).toBe("55432");
    expect(() => parseSafeTargetUrl("postgres://test:test@127.0.0.1:5433/ink-memory")).toThrow(/5433/);
    expect(() => parseSafeTargetUrl("postgres://test:test@127.0.0.1:55432/other")).toThrow(/ink-memory/);
    expect(() => parseSafeTargetUrl("postgres://test:test@127.0.0.1:55432/ink-memory", "postgres://runtime:runtime@127.0.0.1:55432/ink-memory")).toThrow(/runtime DATABASE_URL/);
  });

  it("produces order-independent primary-key fingerprints", () => {
    expect(fingerprintIds(["b", "a"])).toBe(fingerprintIds(["a", "b"]));
    expect(fingerprintIds(["a"])).not.toBe(fingerprintIds(["b"]));
  });

  it("validates relations, enums, and workspace JSON", () => {
    expect(validateSourceRows({
      users: [{ id: 1, email: "fixture@example.test" }],
      story_workspace_workspaces: [{ id: "w1", owner_id: 1, settings: "{}" }],
      story_workspace_stories: [{ id: "s1", identifier: "story-1", author_id: 1, workspace_id: "w1", status: "draft", review_status: "pending", type: "script", agent_generated: 1 }],
    }).counts).toEqual({ users: 1, story_workspace_workspaces: 1, story_workspace_stories: 1 });
    expect(() => validateSourceRows({
      users: [{ id: 1, email: "fixture@example.test" }],
      story_workspace_workspaces: [{ id: "w1", owner_id: 2, settings: "{}" }],
      story_workspace_stories: [],
    })).toThrow(/unknown owner/);
  });
});
