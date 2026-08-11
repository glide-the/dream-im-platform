import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { storyWorkspaceStories } from "./schema";

describe("final Story Artifact schema contract", () => {
  it("keeps Artifact and index state independent without a boolean shadow truth", () => {
    const columns = getTableConfig(storyWorkspaceStories).columns.map((column) => column.name);

    expect(columns).toContain("artifact_status");
    expect(columns).not.toContain("artifact_available");
  });

  it("declares the conditional Artifact identity and review integrity gates", () => {
    const checks = getTableConfig(storyWorkspaceStories).checks.map((check) => check.name);

    expect(checks).toEqual(expect.arrayContaining([
      "story_workspace_stories_artifact_status_check",
      "story_workspace_stories_artifact_identity_check",
      "story_workspace_stories_artifact_revision_state_check",
      "story_workspace_stories_review_integrity_check",
      "story_workspace_stories_business_review_check",
    ]));
  });
});
