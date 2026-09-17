// [Input] Actual creation composition with fixed repository facts and rollback-capable test UOW injection.
// [Output] Atomic write order, consumed/fresh semantic replay, source/owner failures and clean retry boundaries.
// [Pos] Provider-free orchestration regression; actual SQL/concurrency/public acceptance remains independent.
// [Sync] 2026-09-15: verify new creation/retry behavior without registering frozen shared contracts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), analyze: vi.fn(), find: vi.fn(), receipt: vi.fn(),
  repo: Object.fromEntries(["lockKey", "assertWorkspace", "context", "source", "tokenConsumption", "scopedRun", "clock", "insertRun", "consume", "queue", "append"].map(key => [key, vi.fn()])) }));
vi.mock("./workflowRunCreationRepository", () => ({ WorkflowRunCreationRepository: class {
  runs = { read: mocks.read };
  constructor() { for (const [key, method] of Object.entries(mocks.repo)) Object.assign(this, { [key]: method }); }
} }));
vi.mock("./workflowRunCreationSemantics", async importOriginal => ({ ...await importOriginal<typeof import("./workflowRunCreationSemantics")>(), analyzeWorkflowRunCreation: mocks.analyze }));
vi.mock("./receipts", async importOriginal => ({ ...await importOriginal<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; execute = mocks.receipt; } }));
import { z } from "zod";
import type { DataTransaction } from "./database";
import { WorkflowRunCreationService } from "./workflowRunCreationService";
import type { WorkflowRunCreationContext } from "./workflowRunCreationRepository";
import { frozenRunSourceFromContext, type WorkflowRunSource } from "./workflowRunCreationSemantics";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { operationInputDigest } from "./receipts";
import { workflowRunCreateInputDto } from "./workflowRunCreationDto";
import { AuthBoundaryError } from "../auth/config";
type RunRow = ReturnType<typeof validWorkflowRun>;
type Consumption = { token_digest: string; workflow_run_id: string; workflow_preflight_id: string; workspace_id: string; actor_id: string; idempotency_key: string; semantic_fingerprint: string };
type State = { runs: RunRow[]; consumption: Consumption | null; context: WorkflowRunCreationContext; receipt: { result: unknown; inputSha256: string; threadScope: string | null; runScope: string | null; editorSessionScope: null } | null; events: string[] };
let state: State, boundaries: string[];
const secret = "0123456789abcdef0123456789abcdef", template = validWorkflowRun(), hash = template.semantic_fingerprint;
const principal = { subject: "subject", canonical_user_id: template.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const authority = () => new WorkflowTokenAuthority(Buffer.from(secret));
function input() { return { workspace_id: "workspace", workflow_preflight_id: state.context.workflow_preflight_id,
  preflight_token: authority().issueStored({ ...state.context, deck_runtime_snapshot_id: state.context.deck_runtime_snapshot_id! }), idempotency_key: "business_key",
  source_voice_thread_id: null, source_message_id: null, source_message_time: null }; }
async function transaction<T>(action: (tx: DataTransaction) => Promise<T>) {
  const before = structuredClone(state);
  try { const result = await action({ execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as DataTransaction); boundaries.push("commit"); return result; }
  catch (error) { state = before; boundaries.push("rollback"); throw error; }
}
function service() { return new WorkflowRunCreationService(transaction); }
function create(raw = input(), request = "original") { return service().execute("workflow-run.create", "service", principal, request, raw); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", secret); boundaries = [];
  const pf = validWorkflowPreflightRow();
  state = { runs: [], consumption: null, receipt: null, events: [], context: { ...pf,
    workflow_preflight_id: template.workflow_preflight_id, binding_revision: template.binding_revision, runtime_plugin_lock_id: template.runtime_plugin_lock_id,
    deck_runtime_snapshot_id: template.deck_runtime_snapshot_id, input_hash: template.input_hash, request_fingerprint: hash,
    updated_at: pf.created_at, preflight_token_hash: null, deck_plugin_binding_id: template.deck_plugin_binding_id,
    binding_workspace_id: "workspace", binding_creator_id: template.created_by, manifest_hash: template.deck_plugin_manifest_hash,
    lock_manifest_hash: template.deck_plugin_manifest_hash, workflow_definition_ref: template.workflow_definition_ref, lock_json: "{}" } };
  state.context.preflight_token_hash = authority().tokenHash(input().preflight_token);
  mocks.repo.context.mockImplementation(() => structuredClone(state.context));
  mocks.repo.tokenConsumption.mockImplementation(() => structuredClone(state.consumption));
  mocks.repo.scopedRun.mockImplementation((key: string) => state.runs.find(run => run.idempotency_key === key) ?? null);
  mocks.read.mockImplementation((_owner: string, lookup: { workflow_run_id: string }) => structuredClone(state.runs.find(run => run.workflow_run_id === lookup.workflow_run_id) ?? null));
  mocks.repo.clock.mockResolvedValue("2026-09-14T00:00:00.123455+00:00");
  mocks.analyze.mockImplementation((context: WorkflowRunCreationContext, source: WorkflowRunSource) => ({ fingerprint: hash, frozenSource: frozenRunSourceFromContext(context, source), lockDigest: hash }));
  mocks.repo.insertRun.mockImplementation((fields: Record<string, unknown>) => {
    state.events.push("insert"); state.runs.push({ ...template, ...fields, workflow_run_id: String(fields.id), status: "preflight", status_version: 1 } as RunRow);
    delete (state.runs.at(-1)! as RunRow & { id?: string }).id;
  });
  mocks.repo.consume.mockImplementation((fields: Consumption) => { state.events.push("consume"); state.consumption = fields; state.context.consumed_at = "2026-09-14T00:00:00.123455+00:00"; });
  mocks.repo.append.mockImplementation((fields: { transition_seq: number }) => { state.events.push(`transition${fields.transition_seq}`); });
  mocks.repo.queue.mockImplementation((runId: string) => { state.events.push("queue"); Object.assign(state.runs.find(run => run.workflow_run_id === runId)!, { status: "queued", status_version: 2 }); });
  mocks.find.mockImplementation(() => state.receipt);
  mocks.receipt.mockImplementation(async (_name: string, _request: string, raw: unknown, output: z.ZodType, action: () => Promise<unknown>, threadScope: string | null, _editor: null, runScope: string) => {
    const result = output.parse(await action()); state.receipt = { result, inputSha256: operationInputDigest(raw), threadScope, runScope, editorSessionScope: null };
    state.events.push("receipt", "audit"); return result;
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("atomic original Run creation", () => {
  it("commits initial Run, token mapping, both transitions, queued state and scoped receipt/audit together", async () => {
    const result = await create(); expect(result.run.status).toBe("queued"); expect(result.run.status_version).toBe(2);
    expect(state.events).toEqual(["insert", "consume", "transition1", "queue", "transition2", "receipt", "audit"]); expect(boundaries).toEqual(["commit"]);
    expect(state.receipt?.runScope).toBe(result.run.workflow_run_id); expect(state.consumption?.workflow_run_id).toBe(result.run.workflow_run_id);
    expect(mocks.repo.insertRun.mock.calls[0][0]).not.toHaveProperty("agent_session_id");
  });
  it.each(["consume", "queue", "append"])("rolls back every write when %s fails", async method => {
    mocks.repo[method].mockRejectedValueOnce(new Error("Injected boundary failure"));
    await expect(create()).rejects.toThrow("Injected boundary failure");
    expect(state.runs).toEqual([]); expect(state.consumption).toBeNull(); expect(state.receipt).toBeNull(); expect(state.events).toEqual([]); expect(boundaries).toEqual(["rollback"]);
  });
  it("recovers the original bounded receipt after expiry before examining token/current PF", async () => {
    const raw = input(), first = await create(raw); state.context.expires_at = "2000-01-01T00:00:00Z";
    const events = [...state.events]; mocks.repo.context.mockClear(); expect(await create(raw)).toEqual(first);
    expect(mocks.repo.context).not.toHaveBeenCalled(); expect(state.events).toEqual(events);
  });
  it("recovers a consumed original token under a new request even after PF expiry, with no new Run/history/consumption", async () => {
    const raw = input(), first = await create(raw); state.receipt = null; state.events = []; mocks.repo.clock.mockResolvedValue("2030-01-01T00:00:00Z");
    expect(await create(raw, "new_request")).toEqual(first); expect(state.runs).toHaveLength(1); expect(state.events).toEqual(["receipt", "audit"]);
  });
  it("consumes a fresh PF for an existing semantic key without adding Run/history", async () => {
    const first = await create(); state.receipt = null; state.events = []; state.consumption = null;
    state.context = { ...state.context, workflow_preflight_id: `pf_${"e".repeat(32)}`, consumed_at: null };
    state.context.preflight_token_hash = authority().tokenHash(input().preflight_token);
    expect(await create(input(), "fresh_request")).toEqual(first);
    expect(state.events).toEqual(["consume", "receipt", "audit"]); expect(state.runs).toHaveLength(1);
    expect(state.consumption?.workflow_preflight_id).toBe(state.context.workflow_preflight_id);
  });
  it.each(["actor_id", "workspace_id", "idempotency_key", "semantic_fingerprint", "workflow_run_id", "workflow_preflight_id"] as const)("rejects consumed-token mapping with mismatched %s", async field => {
    const raw = input(); await create(raw); state.receipt = null; state.events = []; state.consumption![field] = "conflict";
    await expect(create(raw, "different_request")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 }); expect(state.events).toEqual([]);
  });
  it.each(["expired", "consumed", "hash", "signature"])("rejects fresh-token %s before writes", async kind => {
    const raw = input();
    if (kind === "expired") mocks.repo.clock.mockResolvedValue("2026-09-14T00:00:00.123456+00:00");
    if (kind === "consumed") state.context.consumed_at = state.context.created_at;
    if (kind === "hash") state.context.preflight_token_hash = hash;
    if (kind === "signature") raw.preflight_token = "pft_invalid";
    await expect(create(raw)).rejects.toBeInstanceOf(AuthBoundaryError); expect(state.events).toEqual([]);
  });
  it("rejects a forged or foreign source tuple before any write", async () => {
    const raw = { ...input(), source_voice_thread_id: "thread", source_message_id: "message", source_message_time: "2026-09-14T00:00:00.123456+00:00" };
    mocks.repo.source.mockResolvedValue({ thread_id: "thread", deck_id: "deck", message_id: "message", role: "user", created_at: "2026-09-14T00:00:00.123455+00:00" });
    await expect(service().execute("workflow-run.create", "service", principal, "original", raw)).rejects.toMatchObject({ code: "WORKFLOW_SOURCE_NOT_AUTHORIZED", status: 403 }); expect(state.events).toEqual([]);
  });
  it("rejects input/scope/owner/receipt-input conflicts without modifying persisted facts", async () => {
    expect(workflowRunCreateInputDto.safeParse({ ...input(), created_by: "caller" }).success).toBe(false);
    await expect(service().execute("workflow-run.create", "service", { ...principal, scopes: ["dream:read"] }, "original", input())).rejects.toMatchObject({ status: 403 });
    await create(); const before = structuredClone(state); await expect(create({ ...input(), idempotency_key: "changed" })).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT" }); expect(state).toEqual(before);
    mocks.repo.assertWorkspace.mockRejectedValueOnce(new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403)); await expect(create()).rejects.toMatchObject({ status: 403 }); expect(state).toEqual(before);
  });
  it("rolls back retry's read-only prerequisite then repeats frozen/terminal facts in one creation UOW", async () => {
    const original = { ...template, status: "cancelled", created_at: "2026-09-14T00:00:00.123454+00:00", completed_at: "2026-09-14T00:00:00.123455+00:00" };
    state.runs.push(original); const raw = { ...input(), workflow_run_id: original.workflow_run_id }; const { source_voice_thread_id: _thread, source_message_id: _message, source_message_time: _time, ...retry } = raw;
    const result = await service().execute("workflow-run.retry", "service", principal, "retry_request", retry);
    expect(result.run.retry_of_run_id).toBe(original.workflow_run_id); expect(boundaries).toEqual(["rollback", "commit"]); expect(state.runs).toHaveLength(2);
  });
  it("rejects retry with changed frozen source or successful/nonterminal original state", async () => {
    const original = { ...template, status: "cancelled", completed_at: template.created_at }; state.runs.push(original);
    const retry = { workspace_id: "workspace", workflow_run_id: original.workflow_run_id, workflow_preflight_id: input().workflow_preflight_id, preflight_token: input().preflight_token, idempotency_key: "new_key" };
    mocks.read.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, input_hash: `sha256:${"f".repeat(64)}` });
    await expect(service().execute("workflow-run.retry", "service", principal, "original", retry)).rejects.toMatchObject({ code: "RETRY_SOURCE_MISMATCH" }); expect(state.events).toEqual([]); expect(boundaries).toEqual(["rollback", "rollback"]);
    mocks.read.mockReset().mockResolvedValue({ ...template }); await expect(service().execute("workflow-run.retry", "service", principal, "other", retry)).rejects.toMatchObject({ code: "RETRY_SOURCE_MISMATCH" });
  });
});
