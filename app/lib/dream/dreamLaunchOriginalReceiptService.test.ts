// [Input] Original component receipts and fixed current source/frozen/lease repository facts.
// [Output] Exact source/claim/finish recovery with absent, scope, corruption and stale-authority failures.
// [Pos] Provider-free recovery gate; public GET/SQL validation remains separate.
// [Sync] 2026-09-15: use real source identity/claim codec and current-authority validators.
import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), source: vi.fn(), clock: vi.fn(), scope: vi.fn(), workspace: vi.fn(), facts: vi.fn() }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; } }));
vi.mock("./dreamLaunchSourceRepository", () => ({ DreamLaunchSourceRepository: class { existingMessage = mocks.source; clock = mocks.clock; requireScope = mocks.scope; } }));
vi.mock("./dreamLaunchDispatchRepository", () => ({ DreamLaunchDispatchRepository: class { ownedWorkspace = mocks.workspace; } }));
vi.mock("./dreamLaunchDispatchService", async original => ({ ...await original<typeof import("./dreamLaunchDispatchService")>(), loadDreamLaunchDispatchFacts: mocks.facts }));
import type { DataTransaction } from "./database";
import { AuthBoundaryError } from "../auth/config";
import { operationInputDigest } from "./receipts";
import { dreamLaunchSourceIdentity, dreamLaunchSourceEnvelope } from "./dreamLaunchSourceSemantics";
import { dreamLaunchDispatchContextDto } from "./dreamLaunchDispatchDto";
import { overlayDreamLaunchClaim } from "./dreamLaunchDispatchCodec";
import { readOriginalDreamLaunchReceipt } from "./dreamLaunchOriginalReceiptService";
const clock = "2026-09-14T00:00:00.123456+00:00", canonical = "9007199254740993";
const principal = { subject: "subject", canonical_user_id: canonical, client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const command = { workspace_id: "workspace", deck_id: "deck", agent_id: null, goal: "目标😀", idempotency_key: "source:one" };
let sourceResult: { source: { thread_id: string; message_id: string; message_time: string; request_fingerprint: string; created: boolean } };
let claimResult: z.output<typeof import("./dreamLaunchDispatchDto").dreamLaunchDispatchClaimOutputDto>;
let sourceRow: Record<string, unknown>, facts: Record<string, unknown>;
let prior: { result: unknown; inputSha256: string; threadScope: string | null; editorSessionScope: string | null; runScope: string | null };
const runId = `run_${"a".repeat(32)}`, claimId = `dlc_${"b".repeat(32)}`;
const read = (name = "dream-launch-source.ensure", identity = principal) => readOriginalDreamLaunchReceipt({} as DataTransaction, "service", identity, name, "original");
function dispatchPrior(result: unknown = claimResult) { prior = { result, inputSha256: "opaque-input-digest", threadScope: sourceResult.source.thread_id, editorSessionScope: null, runScope: runId }; }
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const identity = await dreamLaunchSourceIdentity(canonical, command);
  sourceResult = { source: { thread_id: identity.threadId, message_id: identity.messageId, message_time: clock, request_fingerprint: identity.requestFingerprint, created: true } };
  sourceRow = { thread_id: identity.threadId, role: "user", user_id: canonical, deck_id: command.deck_id, voice_id: null, created_at: clock,
    metadata: dreamLaunchSourceEnvelope(canonical, command, identity.requestFingerprint).metadata };
  const context = dreamLaunchDispatchContextDto.parse({ workflow_run_id: runId, thread_id: identity.threadId, deck_id: command.deck_id, agent_id: null,
    deck_plugin_id: "plugin", deck_plugin_version: "1.0.0", deck_plugin_binding_id: "binding", binding_revision: 1, deck_runtime_snapshot_id: "snapshot", runtime_plugin_lock_id: "lock" });
  const overlay = await overlayDreamLaunchClaim(String(sourceRow.metadata), { context, claim_id: claimId, now: clock, project_slug: "proj-fixed", instruction_text: "完整Dream指令😀" });
  claimResult = { claimed: true, workflow_run_id: runId, thread_id: identity.threadId, message_id: identity.messageId,
    context, claim_id: claimId, parts_json: overlay.parts_json, metadata_json: overlay.runtime_metadata_json };
  facts = { store: { source: vi.fn().mockImplementation(() => ({ ...sourceRow, metadata: overlay.metadata_json, parts: overlay.parts_json })) },
    source: { thread_id: identity.threadId, message_id: identity.messageId }, now: clock, context, projectSlug: "proj-fixed",
    sourceFields: { workflow_run_id: runId, thread_id: identity.threadId, message_id: identity.messageId } };
  prior = { result: sourceResult, inputSha256: operationInputDigest(command), threadScope: identity.threadId, editorSessionScope: null, runScope: null };
  mocks.find.mockImplementation(() => structuredClone(prior)); mocks.source.mockImplementation(() => structuredClone(sourceRow)); mocks.clock.mockResolvedValue(clock);
  mocks.workspace.mockResolvedValue(command.workspace_id); mocks.facts.mockImplementation(() => facts);
});
afterEach(() => vi.unstubAllEnvs());
it("recovers complete original source after repeating current owned scope, raw input and deterministic source/time", async () => {
  expect(await read()).toEqual({ status: "committed", operation: "dream-launch-source.ensure", request_id: "original", result: sourceResult });
  expect(mocks.scope).toHaveBeenCalledWith(command.workspace_id, command.deck_id); expect(mocks.source).toHaveBeenCalledWith(sourceResult.source.message_id);
});
it.each(["dream-launch-source.ensure", "dream-launch-dispatch.claim", "dream-launch-dispatch.finish"])("returns explicit absent for %s without looking up actor-selected business facts", async name => {
  mocks.find.mockResolvedValueOnce(null); expect(await read(name)).toEqual({ status: "absent", operation: name, request_id: "original" }); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
});
it.each(["threadScope", "editorSessionScope", "runScope"])("rejects source receipt with invalid %s", async field => {
  Object.assign(prior, { [field]: "foreign" }); await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it("fails closed on deleted source, removed enabled scope or changed original input hash", async () => {
  mocks.source.mockResolvedValueOnce(null); await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_RECEIPT_INVALID", status: 503 });
  mocks.scope.mockRejectedValueOnce(new AuthBoundaryError("DECK_ACCESS_DENIED", 404)); await expect(read()).rejects.toMatchObject({ status: 404 });
  prior.inputSha256 = "different"; await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it.each(["message_time", "request_fingerprint", "message_id"])("refuses a bounded source with changed %s", async field => {
  const value = field === "message_time" ? "2026-09-14T00:00:00.123455+00:00" : field === "message_id" ? "00000000-0000-4000-8000-000000000000" : `sha256:${"f".repeat(64)}`;
  Object.assign(sourceResult.source, { [field]: value }); await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it("recovers an exact active original claim with current parts/context and canonical Runtime metadata", async () => {
  dispatchPrior(); expect(await read("dream-launch-dispatch.claim")).toEqual({ status: "committed", operation: "dream-launch-dispatch.claim", request_id: "original", result: claimResult });
  expect(mocks.facts).toHaveBeenCalledWith({}, canonical, { workspace_id: command.workspace_id, workflow_run_id: runId });
});
it.each(["threadScope", "editorSessionScope", "runScope"])("rejects dispatch receipt with invalid %s", async field => {
  dispatchPrior(); Object.assign(prior, { [field]: "foreign" }); await expect(read("dream-launch-dispatch.claim")).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it("refuses removed Run/workspace owner and current frozen/source conflicts before claim recovery", async () => {
  dispatchPrior(); mocks.workspace.mockResolvedValueOnce(null); await expect(read("dream-launch-dispatch.claim")).rejects.toMatchObject({ status: 403 });
  mocks.facts.mockRejectedValueOnce(new AuthBoundaryError("DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", 409)); await expect(read("dream-launch-dispatch.claim")).rejects.toMatchObject({ status: 409 });
});
it.each(["expired", "different_claim", "dispatched"])("refuses %s original Runtime claim authority", async kind => {
  dispatchPrior(); const store = facts.store as { source: Mock<() => Record<string, unknown>> };
  if (kind === "expired") facts.now = "2026-09-14T00:05:00.123456+00:00";
  else { const current = await store.source(); current.metadata = String(current.metadata).replace(kind === "different_claim" ? claimId : '"dispatching"', kind === "different_claim" ? `dlc_${"f".repeat(32)}` : '"dispatched"'); store.source.mockResolvedValue(current); }
  await expect(read("dream-launch-dispatch.claim")).rejects.toMatchObject({ code: "DREAM_LAUNCH_CLAIM_STALE", status: 409 });
});
it.each(["parts_json", "metadata_json", "context"])("rejects altered bounded claim %s", async field => {
  if (!claimResult.claimed) throw new Error("Claim vector required");
  Object.assign(claimResult, { [field]: field === "context" ? { ...claimResult.context, deck_id: "foreign" } : field === "parts_json" ? '[{"type":"text","text":"different"}]' : "{}" });
  dispatchPrior(); await expect(read("dream-launch-dispatch.claim")).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it("recovers bounded no-claim and finish facts without issuing any Runtime authority", async () => {
  const source = { workflow_run_id: runId, thread_id: sourceResult.source.thread_id, message_id: sourceResult.source.message_id };
  dispatchPrior({ claimed: false, ...source }); expect(await read("dream-launch-dispatch.claim")).toMatchObject({ status: "committed", result: { claimed: false, ...source } });
  dispatchPrior({ finished: true, ...source }); expect(await read("dream-launch-dispatch.finish")).toMatchObject({ status: "committed", result: { finished: true, ...source } });
});
it("rejects invalid result, foreign source and missing write scope before original recovery", async () => {
  prior.result = { arbitrary: true }; await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_RECEIPT_INVALID", status: 503 });
  dispatchPrior({ finished: true, workflow_run_id: runId, thread_id: sourceResult.source.thread_id, message_id: "00000000-0000-4000-8000-000000000000" });
  await expect(read("dream-launch-dispatch.finish")).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
  await expect(read(undefined, { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ status: 403 });
  await expect(read("dream-launch-dispatch.patch")).rejects.toMatchObject({ status: 404 });
});
