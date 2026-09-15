// [Input] Registry120 service commands with an in-memory Drizzle repository seam.
// [Output] Atomic submit/replay/fact/claim/lease/ack and scope-policy assertions.
// [Pos] Provider-free domain state-machine test; HTTP, PostgreSQL, Runtime and files stay outside.
// [Sync] 2026-09-16: verify Admin owns confirmation persistence and durable delivery transitions.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";

const state = vi.hoisted(() => ({
  row: null as null | { id: string; thread_id: string; role: string; parts_json: string; metadata_json: string; created_at: string; actor_id: string },
  run: { workflow_run_id: `run_${"a".repeat(32)}`, workspace_id: "workspace-1", status: "running", status_version: 2, source_voice_thread_id: "thread-1" },
  transitions: [] as string[],
  receiptActors: [] as string[],
}));

vi.mock("./storyWorkspaceConfirmationRepository", () => ({
  StoryWorkspaceConfirmationRepository: class {
    async ownedRun() { return { ...state.run }; }
    async scopedRun() { return { ...state.run }; }
    async lockMessageIdentity() {}
    async message(messageId: string) { return state.row?.id === messageId ? { ...state.row } : null; }
    async threadConfirmationRows(threadId: string) { return state.row?.thread_id === threadId ? [{ ...state.row }] : []; }
    async pendingCandidates(messageId: string | null) {
      return state.row !== null && (messageId === null || state.row.id === messageId) ? [{ ...state.row }] : [];
    }
    async insertMessage(id: string, threadId: string, partsJson: string, metadataJson: string, actor: string) {
      if (state.row !== null) return false;
      state.row = { id, thread_id: threadId, role: "user", parts_json: partsJson,
        metadata_json: metadataJson, created_at: "2026-09-16T00:00:00Z", actor_id: actor };
      return true;
    }
    async compareAndSetMessage(id: string, oldParts: string, oldMetadata: string, parts: string, metadata: string) {
      if (state.row?.id !== id || state.row.parts_json !== oldParts || state.row.metadata_json !== oldMetadata) return false;
      state.row = { ...state.row, parts_json: parts, metadata_json: metadata }; return true;
    }
    async compareAndSetMetadata(id: string, oldMetadata: string, metadata: string) {
      if (state.row?.id !== id || state.row.metadata_json !== oldMetadata) return false;
      state.row = { ...state.row, metadata_json: metadata }; return true;
    }
    async clockSeconds() { return 100; }
    async clockText() { return "2026-09-16 00:00:00+00"; }
    async advanceRun(_current: unknown, target: string) {
      state.transitions.push(target);
      state.run = { ...state.run, status: target, status_version: state.run.status_version + 1 };
      return { ...state.run };
    }
  },
}));
vi.mock("./receipts", async original => ({
  ...await original<typeof import("./receipts")>(),
  ReceiptRepository: class {
    constructor(_tx: unknown, _service: string, actor: string) { state.receiptActors.push(actor); }
    async execute(_name: string, _requestId: string, _input: unknown, output: { parse(value: unknown): unknown }, action: () => Promise<unknown>) {
      return output.parse(await action());
    }
  },
}));

import {
  runStoryWorkspaceConfirmationBackgroundOperation,
  runStoryWorkspaceConfirmationOAuthOperation,
} from "./storyWorkspaceConfirmationService";

const runId = `run_${"a".repeat(32)}`;
const command = {
  storyWorkspaceRunId: runId,
  threadId: "thread-1",
  baseRevisions: { characters: 2, scenes: 3, storyboards: 4 },
  edits: [{ stage: "characters", entityId: "character-1", fields: { displayName: "主角", summary: null } }],
  idempotencyKey: "swc_test-1",
};
const principal = { subject: "oauth-subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" as const };
const service = { id: "dream-service", backgroundScopes: ["story-confirmation:dispatch"] };
const tx = {} as DataTransaction;

beforeEach(() => {
  state.row = null;
  state.run = { workflow_run_id: runId, workspace_id: "workspace-1", status: "running", status_version: 2, source_voice_thread_id: "thread-1" };
  state.transitions.length = 0;
  state.receiptActors.length = 0;
  vi.stubEnv("DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS", "120");
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
});
afterEach(() => vi.unstubAllEnvs());

it("owns the complete submit, claim, lease, ack and fact lifecycle", async () => {
  const submitted = await runStoryWorkspaceConfirmationOAuthOperation(
    "story-workspace-confirmation.submit", { command_json: JSON.stringify(command) },
    principal, service.id, "request-submit", tx,
  );
  expect(submitted).toMatchObject({ status: "accepted", replayed: false, dispatched: false,
    story_workspace_run_id: runId, thread_id: "thread-1" });
  expect(submitted.dispatch).not.toBeNull();
  expect(state.transitions).toEqual(["output_validating", "pending_review", "confirmed"]);
  expect(state.receiptActors).toEqual([principal.subject]);

  const claim = await runStoryWorkspaceConfirmationBackgroundOperation(
    "story-workspace-confirmation.claim",
    { message_id: submitted.message_id, claim_id: "claim-1" }, service, tx,
  );
  expect(claim.dispatch).toMatchObject({ message_id: submitted.message_id, actor_id: "42" });
  expect(JSON.parse(claim.dispatch!.metadata_json)).toMatchObject({
    dispatch_status: "dispatching", dispatch_claim_id: "claim-1", dispatch_claim_lease_until: 220,
  });

  const lease = await runStoryWorkspaceConfirmationBackgroundOperation(
    "story-workspace-confirmation.lease",
    { message_id: submitted.message_id, claim_id: "claim-1", duration_seconds: 30 }, service, tx,
  );
  expect(lease).toEqual({ renewed: true, lease_until: 130 });

  await expect(runStoryWorkspaceConfirmationBackgroundOperation(
    "story-workspace-confirmation.lease",
    { message_id: submitted.message_id, claim_id: "claim-1", duration_seconds: 121 }, service, tx,
  )).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });

  await expect(runStoryWorkspaceConfirmationBackgroundOperation(
    "story-workspace-confirmation.ack",
    { message_id: submitted.message_id, claim_id: "claim-1" }, service, tx,
  )).resolves.toEqual({ acked: true });
  expect(JSON.parse(state.row!.metadata_json)).toMatchObject({ dispatch_status: "dispatched" });

  const fact = await runStoryWorkspaceConfirmationOAuthOperation(
    "story-workspace-confirmation.fact", { workflow_run_id: runId }, principal,
    service.id, "request-fact", tx,
  );
  expect(fact).toEqual({ workflow_run_id: runId, thread_id: "thread-1",
    confirmation_accepted: true, confirmation_dispatched: true });

  const replay = await runStoryWorkspaceConfirmationOAuthOperation(
    "story-workspace-confirmation.submit", { command_json: JSON.stringify(command) },
    principal, service.id, "request-replay", tx,
  );
  expect(replay).toMatchObject({ replayed: true, dispatched: true, dispatch: null });
});

it("rejects missing OAuth/background scope before persistence", async () => {
  await expect(runStoryWorkspaceConfirmationOAuthOperation(
    "story-workspace-confirmation.submit", { command_json: JSON.stringify(command) },
    { ...principal, scopes: ["dream:read"] }, service.id, "request-denied", tx,
  )).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  await expect(runStoryWorkspaceConfirmationBackgroundOperation(
    "story-workspace-confirmation.claim", { message_id: null, claim_id: "claim-1" },
    { ...service, backgroundScopes: [] }, tx,
  )).rejects.toMatchObject({ code: "DREAM_SERVICE_SCOPE_REQUIRED", status: 403 });
  expect(state.row).toBeNull();
});
