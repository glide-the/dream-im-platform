import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryArtifactSourceRecord } from "../story-source/repository";

vi.mock("server-only", () => ({}));
import {
  readStoryArtifactPreview,
  readStoryArtifactSurface,
} from "./reader";

const runId = `run_${"a".repeat(32)}`;
const source: StoryArtifactSourceRecord = {
  id: "story-safe",
  workspaceId: "workspace-safe",
  authorId: "7",
  sourceType: "dream_episode",
  sourceRunId: runId,
  sourceThreadRef: "thread-safe",
  sourceProjectId: "project-safe",
  indexedScriptRevision: null,
};

let root = "";

async function writeScope(options?: { projectText?: string; script?: string }) {
  const thread = join(root, source.sourceThreadRef);
  const runRoot = join(thread, ".dream", "runtime", "runs", runId);
  const projectRoot = join(thread, "stories", source.sourceProjectId);
  await mkdir(runRoot, { recursive: true });
  await Promise.all([
    mkdir(join(projectRoot, "episodes", "EP01"), { recursive: true }),
    mkdir(join(projectRoot, "episodes", "EP02"), { recursive: true }),
  ]);
  await writeFile(
    join(runRoot, "episode.json"),
    JSON.stringify({
      schema_version: "dream-episode/v2",
      workflow_run_id: runId,
      story_slug: source.sourceProjectId,
      active_episode_uid: "1".repeat(32),
      episodes: [
        {
          episode_uid: "1".repeat(32),
          episode_number: 1,
          episode_code: "EP01",
          episode_root: `stories/${source.sourceProjectId}/episodes/EP01`,
          created_at: "2026-08-10T00:00:00Z",
        },
        {
          episode_uid: "2".repeat(32),
          episode_number: 2,
          episode_code: "EP02",
          episode_root: `stories/${source.sourceProjectId}/episodes/EP02`,
          created_at: "2026-08-10T00:01:00Z",
        },
      ],
      revision: 2,
      updated_at: "2026-08-10T00:01:00Z",
    }),
    "utf8",
  );
  await writeFile(
    join(projectRoot, "project.yaml"),
    options?.projectText ?? `project_id: ${source.sourceProjectId}\nproject_name: Safe\n`,
    "utf8",
  );
  await writeFile(
    join(projectRoot, "episodes", "EP01", "script.md"),
    options?.script ?? "第一集\n安全内容\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "episodes", "EP02", "script.md"),
    "第二集\n",
    "utf8",
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ink-admin-artifact-test-"));
  process.env.ARTIFACT_WORKSPACE_ROOT = root;
  process.env.ARTIFACT_PREVIEW_MAX_FILE_BYTES = "8388608";
});

afterEach(async () => {
  delete process.env.ARTIFACT_WORKSPACE_ROOT;
  delete process.env.ARTIFACT_PREVIEW_MAX_FILE_BYTES;
  await rm(root, { recursive: true, force: true });
});

describe("shared Story Artifact reader", () => {
  it("returns a safe multi-Episode surface and a bounded preview", async () => {
    const script = "第一集\n安全内容\n";
    await writeScope({ script });
    const revision = `sha256:${createHash("sha256").update(script).digest("hex")}`;

    const surface = await readStoryArtifactSurface({
      ...source,
      indexedScriptRevision: revision,
    });
    expect(surface).toMatchObject({
      storyId: "story-safe",
      projectId: "project-safe",
      registryRevision: 2,
      indexedScriptRevision: revision,
    });
    expect(surface.episodes.map((episode) => episode.id)).toEqual(["EP01", "EP02"]);
    expect(surface.episodes[0].artifacts.find((item) => item.kind === "script")).toMatchObject({
      available: true,
      revision,
    });
    expect(JSON.stringify(surface)).not.toContain(root);

    const preview = await readStoryArtifactPreview({
      source,
      episodeId: "EP01",
      kind: "script",
      offset: 0,
      limit: 1024,
      expectedRevision: revision,
    });
    expect(preview.content).toBe(script);
    expect(preview.etag).toBe(`"${revision}"`);
    expect(preview.nextOffset).toBeNull();
    expect(JSON.stringify(preview)).not.toContain(root);
  });

  it("rejects traversal identities before touching the filesystem", async () => {
    await writeScope();
    await expect(
      readStoryArtifactSurface({ ...source, sourceThreadRef: "../outside" }),
    ).rejects.toMatchObject({ status: 422, code: "STORY_ARTIFACT_CONTRACT_INVALID" });
  });

  it("rejects a symlink in the trusted Project chain", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ink-admin-artifact-outside-"));
    try {
      const thread = join(root, source.sourceThreadRef);
      const runRoot = join(thread, ".dream", "runtime", "runs", runId);
      await mkdir(runRoot, { recursive: true });
      await writeFile(
        join(runRoot, "episode.json"),
        JSON.stringify({
          schema_version: "dream-episode/v1",
          workflow_run_id: runId,
          episode_uid: "1".repeat(32),
          story_slug: source.sourceProjectId,
          episode_code: "EP01",
          episode_root: `stories/${source.sourceProjectId}/episodes/EP01`,
          revision: 1,
          updated_at: "2026-08-10T00:00:00Z",
        }),
        "utf8",
      );
      await mkdir(join(thread, "stories"), { recursive: true });
      await writeFile(join(outside, "project.yaml"), `project_id: ${source.sourceProjectId}\n`, "utf8");
      await symlink(outside, join(thread, "stories", source.sourceProjectId));

      await expect(readStoryArtifactSurface(source)).rejects.toMatchObject({
        status: 422,
        code: "STORY_ARTIFACT_SYMLINK_DENIED",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects invalid Project identity, oversize files, and stale revisions", async () => {
    await writeScope({ projectText: "project_id: other-project\n" });
    await expect(readStoryArtifactSurface(source)).rejects.toMatchObject({
      status: 422,
      code: "STORY_ARTIFACT_PROJECT_IDENTITY_INVALID",
    });

    await rm(root, { recursive: true, force: true });
    root = await mkdtemp(join(tmpdir(), "ink-admin-artifact-test-"));
    process.env.ARTIFACT_WORKSPACE_ROOT = root;
    await writeScope({ script: "x".repeat(128) });
    process.env.ARTIFACT_PREVIEW_MAX_FILE_BYTES = "64";
    await expect(readStoryArtifactSurface(source)).rejects.toMatchObject({ status: 413 });

    process.env.ARTIFACT_PREVIEW_MAX_FILE_BYTES = "8388608";
    await expect(
      readStoryArtifactPreview({
        source,
        episodeId: "EP01",
        kind: "script",
        offset: 0,
        limit: 64,
        expectedRevision: `sha256:${"f".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ status: 409, code: "STORY_ARTIFACT_REVISION_CONFLICT" });
  });
});
