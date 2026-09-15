// [Input] Registry115 guidance DTO/Service with mocked typed Repository and receipt UOW.
// [Output] Exact identity, scope, replay/conflict, state and new-only dispatch assertions.
// [Pos] Provider-free business contract test; no PostgreSQL, Runtime or HTTP.
// [Sync] 2026-09-15: validate Admin-owned guidance persistence semantics.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalContractJson } from "./canonicalContractJson";

const mocks = vi.hoisted(() => ({
  ownedRun: vi.fn(), ownsThread: vi.fn(), lock: vi.fn(), message: vi.fn(), insert: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("./storyWorkspaceGuidanceRepository", () => ({
  StoryWorkspaceGuidanceRepository: class {
    ownedRun = mocks.ownedRun; ownsThread = mocks.ownsThread; lockMessageIdentity = mocks.lock;
    message = mocks.message; insertMessage = mocks.insert;
  },
}));
vi.mock("./receipts", () => ({
  ReceiptRepository: class {
    execute = mocks.execute;
  },
}));

import { AuthBoundaryError } from "../auth/config";
import { storyWorkspaceGuidanceInputDto } from "./storyWorkspaceGuidanceDto";
import { runStoryWorkspaceGuidanceOperation } from "./storyWorkspaceGuidanceService";

const runId = `run_${"a".repeat(32)}`;
const threadId = "thread-guidance";
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };
const input = { workflow_run_id: runId, kind: "free-text" as const, text: "第二集节奏放慢",
  step_id: null, idempotency_key: "key-1" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ownedRun.mockResolvedValue({ workspace_id: "workspace-1", status: "confirmed", source_voice_thread_id: threadId });
  mocks.ownsThread.mockResolvedValue(true); mocks.message.mockResolvedValue(null); mocks.insert.mockResolvedValue(true);
  mocks.execute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
});

it("persists a server-derived immutable message and returns one new dispatch", async () => {
  const result = await runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-1", {} as never,
  );
  expect(result).toMatchObject({ message_id: "guide_key-1", story_workspace_run_id: runId,
    review_action: "guide", status: "accepted", replayed: false, request_id: "request-1" });
  expect(result.dispatch).toMatchObject({ thread_id: threadId, message_id: "guide_key-1",
    metadata: { actor: "42", command_kind: "free-text", request_id: "request-1",
      text_summary: "第二集节奏放慢", review_action: "guide" } });
  expect(result.dispatch?.parts[0].text).toBe(`[story-workspace guidance · run ${runId}] 第二集节奏放慢`);
  const expectedFingerprint = `sha256:${createHash("sha256").update(canonicalContractJson({
    story_workspace_run_id: runId, actor: "42", command_kind: "free-text",
    text: "第二集节奏放慢", step_id: null,
  })).digest("hex")}`;
  expect(result.dispatch?.metadata.command_fingerprint).toBe(expectedFingerprint);
  expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(
    "guide_key-1", threadId,
    canonicalContractJson(result.dispatch?.parts), canonicalContractJson(result.dispatch?.metadata),
  );
  expect(mocks.execute.mock.calls[0].slice(0, 3)).toEqual([
    "story-workspace-guidance.submit", "request-1", input,
  ]);
  expect(mocks.execute.mock.calls[0].slice(5)).toEqual([threadId, null, runId]);
});

it("returns an exact business replay without touching Thread order or dispatching again", async () => {
  const first = await runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-original", {} as never,
  );
  vi.clearAllMocks();
  mocks.ownedRun.mockResolvedValue({ workspace_id: "workspace-1", status: "confirmed", source_voice_thread_id: threadId });
  mocks.ownsThread.mockResolvedValue(true);
  mocks.execute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
  mocks.message.mockResolvedValue({ id: first.message_id, thread_id: threadId, role: "user",
    parts: canonicalContractJson(first.dispatch?.parts), metadata: canonicalContractJson(first.dispatch?.metadata) });
  const replay = await runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-replay", {} as never,
  );
  expect(replay).toEqual({ message_id: "guide_key-1", story_workspace_run_id: runId,
    review_action: "guide", status: "accepted", replayed: true,
    request_id: "request-original", dispatch: null });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("rejects actor-controlled fields, invalid kind fields and conflicting stored identities", async () => {
  expect(storyWorkspaceGuidanceInputDto.safeParse({ ...input, actor: "42" }).success).toBe(false);
  expect(storyWorkspaceGuidanceInputDto.safeParse({ ...input, text: " " }).success).toBe(false);
  expect(storyWorkspaceGuidanceInputDto.safeParse({ ...input, kind: "retry-step", text: null }).success).toBe(false);
  const fingerprint = `sha256:${"a".repeat(64)}`;
  mocks.message.mockResolvedValue({ id: "guide_key-1", thread_id: threadId, role: "user",
    parts: canonicalContractJson([{ type: "text", text: "old" }]),
    metadata: canonicalContractJson({ kind: "story-workspace-guidance", story_workspace_run_id: runId,
      actor: "42", request_id: "old-request", idempotency_key: "key-1", command_kind: "free-text",
      step_id: null, text_summary: "old", review_action: "guide", command_fingerprint: fingerprint }) });
  await expect(runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-conflict", {} as never,
  )).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
});

it.each([
  [null, "WORKFLOW_RUN_NOT_FOUND", 404],
  [{ workspace_id: "workspace-1", status: "pending_review", source_voice_thread_id: threadId }, "WORKFLOW_RUN_NOT_GUIDABLE", 409],
  [{ workspace_id: "workspace-1", status: "confirmed", source_voice_thread_id: null }, "WORKFLOW_RUN_NOT_GUIDABLE", 409],
] as const)("fails closed for invalid Run scope %#", async (run, code, status) => {
  mocks.ownedRun.mockResolvedValue(run);
  await expect(runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-state", {} as never,
  )).rejects.toMatchObject({ code, status });
});

it("requires an owned source Thread and dream:write", async () => {
  mocks.ownsThread.mockResolvedValue(false);
  await expect(runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-thread", {} as never,
  )).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_GUIDABLE", status: 409 });
  await expect(runStoryWorkspaceGuidanceOperation(
    "story-workspace-guidance.submit", input, { ...principal, scopes: ["dream:read"] },
    "dream-service", "request-scope", {} as never,
  )).rejects.toBeInstanceOf(AuthBoundaryError);
});
