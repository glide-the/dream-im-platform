// [Input] Valid and adversarial Registry185-191 payloads.
// [Output] Strict selector/projection validation without hidden actor or storage controls.
// [Pos] Provider-free DTO boundary test.
// [Sync] 2026-09-16: reject arbitrary user, path and SQL-shaped fields.
import { expect, it } from "vitest";
import { storyWorkspaceArtifactIndexInputDto, storyWorkspaceArtifactRunsInputDto,
  storyWorkspaceEpisodeAuthorityEnsureInputDto } from "./storyWorkspaceArtifactDto";

const runId = `run_${"a".repeat(32)}`;
const hash = `sha256:${"b".repeat(64)}`;

it("accepts only closed page and normalized Artifact inputs", () => {
  expect(storyWorkspaceArtifactRunsInputDto.parse({ limit: 100, cursor: null })).toEqual({ limit: 100, cursor: null });
  expect(storyWorkspaceArtifactIndexInputDto.parse({ workflow_run_id: runId, projection: {
    source_project_id: "project-one", title: "Project One", episode_count: 2,
    artifact_manifest_revision: hash, script_revision: hash, script_size_bytes: 123,
    artifact_status: "available",
  } }).workflow_run_id).toBe(runId);
  expect(storyWorkspaceEpisodeAuthorityEnsureInputDto.safeParse({ workflow_run_id: runId,
    story_slug: "project-one", episode_code: "EP01", user_id: "9" }).success).toBe(false);
});

it("rejects paths, invalid slugs, invalid revisions and unsafe numbers", () => {
  for (const projection of [
    { source_project_id: "../project", title: "Project", episode_count: 1, artifact_manifest_revision: hash, script_revision: hash, script_size_bytes: 1, artifact_status: "available" },
    { source_project_id: "project", title: "Project", episode_count: 0, artifact_manifest_revision: hash, script_revision: hash, script_size_bytes: 1, artifact_status: "available" },
    { source_project_id: "project", title: "Project", episode_count: 1, artifact_manifest_revision: "latest", script_revision: hash, script_size_bytes: 1, artifact_status: "available" },
    { source_project_id: "project", title: "Project", episode_count: 1, artifact_manifest_revision: hash, script_revision: hash, script_size_bytes: Number.MAX_SAFE_INTEGER + 1, artifact_status: "available" },
  ]) expect(storyWorkspaceArtifactIndexInputDto.safeParse({ workflow_run_id: runId, projection }).success).toBe(false);
});
