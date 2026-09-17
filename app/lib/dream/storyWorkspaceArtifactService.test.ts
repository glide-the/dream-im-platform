// [Input] Verified Story Workspace actor plus repository-owned Run, launch, title and confirmation rows.
// [Output] Actor-filtered Registry185-186 authority pages with no caller-selected identity or storage fields.
// [Pos] Provider-free DTO-Service-typed Repository verification for the Story Workspace Artifact cutover.
// [Sync] 2026-09-16: prove authority/list composition before Dream reads shared files.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(),
  listAuthorities: vi.fn(),
  storyTitles: vi.fn(),
  confirmationRows: vi.fn(),
}));
vi.mock("./storyWorkspaceArtifactRepository", () => ({
  StoryWorkspaceArtifactRepository: class {
    authority = mocks.authority;
    listAuthorities = mocks.listAuthorities;
    storyTitles = mocks.storyTitles;
    confirmationRows = mocks.confirmationRows;
  },
}));

import type { DataTransaction } from "./database";
import { runStoryWorkspaceArtifactOperation } from "./storyWorkspaceArtifactService";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";

const canonicalUserId = "9007199254740993";
const actor = {
  principal: {
    subject: "auth-user",
    canonical_user_id: canonicalUserId,
    client_id: "browser",
    scopes: ["dream:read", "dream:write"],
    status: "active" as const,
  },
  threadScope: null,
  runScope: null,
};
const tx = {} as DataTransaction;

function authorityRow(runSuffix = "a") {
  const run = {
    ...validWorkflowRun(),
    workflow_run_id: `run_${runSuffix.repeat(32)}`,
    source_voice_thread_id: `thread-${runSuffix}`,
    source_message_id: `message-${runSuffix}`,
    source_message_time: "2026-09-14 00:00:00.123456+00",
    created_at: "2026-09-14 00:00:00.123456+00",
  };
  return {
    ...run,
    thread_id: run.source_voice_thread_id,
    thread_updated_at: "2026-09-14 00:01:00.123456+00",
    thread_voice_id: "voice",
    deck_id: "deck",
    deck_name: "Dream Deck",
    source_metadata: JSON.stringify({
      kind: "story-workspace-dream-launch",
      schemaVersion: "story-workspace-dream-launch/v1",
      visibility: "private",
      actorId: canonicalUserId,
      workspaceId: run.workspace_id,
      deckId: "deck",
      agentId: "voice",
      goal: "Write the first episode",
      workflowRunId: run.workflow_run_id,
      threadId: run.source_voice_thread_id,
      projectStorySlug: "project-one",
      dreamContext: {
        workflow_run_id: run.workflow_run_id,
        thread_id: run.source_voice_thread_id,
        deck_id: "deck",
        agent_id: "voice",
        deck_plugin_id: run.deck_plugin_id,
        deck_plugin_version: run.deck_plugin_version,
        deck_plugin_binding_id: run.deck_plugin_binding_id,
        binding_revision: run.binding_revision,
        deck_runtime_snapshot_id: run.deck_runtime_snapshot_id,
        runtime_plugin_lock_id: run.runtime_plugin_lock_id,
      },
    }),
    release_manifest_json: JSON.stringify({ surfaces: [{ name: "dream" }] }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authority.mockResolvedValue([authorityRow()]);
  mocks.listAuthorities.mockResolvedValue([authorityRow()]);
  mocks.storyTitles.mockResolvedValue([{
    source_run_id: authorityRow().workflow_run_id,
    workspace_id: "workspace",
    source_project_id: "project-one",
    title: "Project One",
    updated_at: "2026-09-14 00:02:00+00",
    story_id: "story",
  }]);
  mocks.confirmationRows.mockResolvedValue([]);
});

it("returns one fully scoped authority projection through the typed repository", async () => {
  const row = authorityRow();
  const result = await runStoryWorkspaceArtifactOperation(
    "story-workspace-artifact.authority",
    { workflow_run_id: row.workflow_run_id },
    actor,
    "dream-service",
    "request-authority",
    tx,
  );
  expect(result).toMatchObject({
    authority: {
      thread_id: row.thread_id,
      deck_id: "deck",
      goal: "Write the first episode",
      project_story_slug: "project-one",
      project_title: "Project One",
      confirmation_accepted: false,
      confirmation_dispatched: false,
    },
  });
  expect(mocks.authority).toHaveBeenCalledWith(
    canonicalUserId,
    row.workflow_run_id,
    false,
  );
});

it("paginates by repository cursor and derives confirmations inside Admin", async () => {
  const first = authorityRow("a");
  const second = {
    ...authorityRow("b"),
    created_at: "2026-09-13 00:00:00.123456+00",
  };
  mocks.listAuthorities.mockResolvedValue([first, second]);
  mocks.storyTitles.mockResolvedValue([]);
  mocks.confirmationRows.mockResolvedValue([{
    id: "confirmation",
    thread_id: first.thread_id,
    created_at: "2026-09-14 00:03:00+00",
    metadata: JSON.stringify({
      kind: "story-workspace-dream-confirmation",
      actor: canonicalUserId,
      thread_id: first.thread_id,
      story_workspace_run_id: first.workflow_run_id,
      dispatch_status: "dispatched",
    }),
  }]);
  const result = await runStoryWorkspaceArtifactOperation(
    "story-workspace-artifact.runs",
    { limit: 1, cursor: null },
    actor,
    "dream-service",
    "request-list",
    tx,
  ) as { runs: Array<{ confirmation_accepted: boolean; confirmation_dispatched: boolean }>; next_cursor: unknown };
  expect(result.runs).toHaveLength(1);
  expect(result.runs[0]).toMatchObject({
    confirmation_accepted: true,
    confirmation_dispatched: true,
  });
  expect(result.next_cursor).toEqual({
    created_at: "2026-09-14T00:00:00.123456+00:00",
    workflow_run_id: first.workflow_run_id,
  });
});

it("fails closed before repository access when read scope is absent", async () => {
  await expect(runStoryWorkspaceArtifactOperation(
    "story-workspace-artifact.authority",
    { workflow_run_id: authorityRow().workflow_run_id },
    { ...actor, principal: { ...actor.principal, scopes: [] } },
    "dream-service",
    "request-denied",
    tx,
  )).rejects.toMatchObject({ status: 403 });
  expect(mocks.authority).not.toHaveBeenCalled();
});
