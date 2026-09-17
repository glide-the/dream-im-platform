// [Input] Registry111 strict DTO, canonical OAuth principal and mocked Repository/receipt seams.
// [Output] Authorization, idempotent dispatch, closed inputs and output projection assertions.
// [Pos] Provider-free Story Workspace review service test; PostgreSQL behavior has a separate restricted-role harness.
// [Sync] 2026-09-15: prove DTO-Service-Repository composition for single and batch review.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transition: vi.fn(), batch: vi.fn(), execute: vi.fn() }));
vi.mock("./storyWorkspaceReviewRepository", () => ({ StoryWorkspaceReviewRepository: class {
  transition = mocks.transition; batch = mocks.batch;
}}));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  execute(...args: unknown[]) { return mocks.execute(...args); }
}}));

import type { DataTransaction } from "./database";
import {
  storyWorkspaceReviewBatchInputDto,
  storyWorkspaceReviewTransitionInputDto,
} from "./storyWorkspaceReviewDto";
import { runStoryWorkspaceReviewOperation } from "./storyWorkspaceReviewService";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" };
const time = "2026-09-15T01:02:03.000Z";
const story = { id: "story-1", identifier: "story-one", title: "标题", description: null,
  status: "published", review_status: "confirmed", review_notes: null, type: "short",
  character_count: 1, scene_count: 1, created_at: time, updated_at: time, confirmed_at: time,
  source_run_id: null, source_project_id: null, episode_count: null, artifact_status: null,
  artifact_manifest_revision: null, script_revision: null, artifact_sync_status: null,
  artifact_indexed_at: null, artifact_sync_error_code: null, script_size_bytes: null,
  artifact_available: null, reconcile_version: null } as const;
const character = { id: "character-1", identifier: "character-one", name: "人物", avatar_url: null,
  identity: null, personality: null, background: null, catchphrase: null, tags: [], story_count: 1,
  review_status: "rejected", review_notes: "重写", status: "active", created_at: time,
  updated_at: time, confirmed_at: null, archived_at: null } as const;
const tx = {} as DataTransaction;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
  mocks.transition.mockResolvedValue({ resource_type: "story", item: story });
  mocks.batch.mockResolvedValue({ success: true, action: "reject", resource_type: "character",
    total_requested: 2, total_updated: 1, skipped_ids: ["character-2"], updated_items: [character] });
});

it("executes one strict transition behind its original receipt", async () => {
  const input = { resource_type: "story", resource_id: "story-1", action: "confirm", review_notes: null } as const;
  const result = await runStoryWorkspaceReviewOperation("story-workspace-review.transition", input,
    principal, "dream-service", "review-original", tx);
  expect(result).toEqual({ resource_type: "story", item: story });
  expect(mocks.transition).toHaveBeenCalledExactlyOnceWith(input, "review-original");
  expect(mocks.execute).toHaveBeenCalledWith("story-workspace-review.transition", "review-original", input,
    expect.anything(), expect.any(Function));
});

it("preserves batch request order/accounting behind one receipt", async () => {
  const input = { resource_type: "character", ids: ["character-1", "character-2"],
    action: "reject", review_notes: "重写" } as const;
  const result = await runStoryWorkspaceReviewOperation("story-workspace-review.batch", input,
    principal, "dream-service", "batch-original", tx);
  expect(result.total_updated).toBe(1);
  expect(result.skipped_ids).toEqual(["character-2"]);
  expect(mocks.batch).toHaveBeenCalledExactlyOnceWith(input, "batch-original");
});

it("rejects generic selectors, invalid transitions, duplicate IDs and oversized notes", () => {
  const transition = { resource_type: "character", resource_id: "character-1", action: "confirm", review_notes: null };
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path", "transaction"])
    expect(storyWorkspaceReviewTransitionInputDto.safeParse({ ...transition, [key]: "caller" }).success).toBe(false);
  expect(storyWorkspaceReviewTransitionInputDto.safeParse({ ...transition, action: "archive" }).success).toBe(false);
  expect(storyWorkspaceReviewBatchInputDto.safeParse({ resource_type: "story", ids: ["same", "same"],
    action: "confirm", review_notes: null }).success).toBe(false);
  expect(storyWorkspaceReviewBatchInputDto.safeParse({ resource_type: "story", ids: ["story-1"],
    action: "reject", review_notes: "x".repeat(2_001) }).success).toBe(false);
});

it("rejects a principal without dream:write before persistence", async () => {
  await expect(runStoryWorkspaceReviewOperation("story-workspace-review.transition",
    { resource_type: "story", resource_id: "story-1", action: "confirm", review_notes: null },
    { ...principal, scopes: ["dream:read"] }, "service", "request", tx))
    .rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  expect(mocks.execute).not.toHaveBeenCalled();
});
