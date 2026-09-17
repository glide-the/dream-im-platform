// [Input] Public production orchestration with explicit transaction and dependency collaborators.
// [Output] Fixed failure order, retained stage commits, bounded reuse and uncertain-final-commit recovery.
// [Pos] Provider-free unit boundary; actual ORM/concurrency/catalog evidence belongs to isolated public tests.
// [Sync] 2026-09-15: exercise secret receipt atomics and durable original input conflicts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ repo: Object.fromEntries(["lockRequest", "assertWorkspace", "association", "reserve", "read", "clock", "active", "checking", "binding", "snapshot", "passed", "failed", "audit"].map(name => [name, vi.fn()])),
  find: vi.fn(), receiptExecute: vi.fn(), deps: Object.fromEntries(["identity", "binding", "manifest", "compatibility", "capabilities", "snapshot", "materialization"].map(name => [name, vi.fn()])) }));
vi.mock("./workflowPreflightExecutionRepository", async importOriginal => {
  const original = await importOriginal<typeof import("./workflowPreflightExecutionRepository")>();
  return { ...original, WorkflowPreflightExecutionRepository: class {
    constructor(_tx: unknown, public context: import("./workflowPreflightExecutionRepository").PreflightRequestContext) {
      for (const [key, fn] of Object.entries(mocks.repo)) Object.assign(this, { [key]: (...args: unknown[]) => fn(this.context, ...args) });
    }
  } };
});
vi.mock("./receipts", async importOriginal => {
  const original = await importOriginal<typeof import("./receipts")>();
  return { ...original, ReceiptRepository: class { find = mocks.find; execute = mocks.receiptExecute; } };
});
import { WorkflowPreflightExecutionService } from "./workflowPreflightExecutionService";
import { workflowPreflightExecutionInputDto } from "./workflowPreflightExecutionDto";
import { WorkflowPreflightCheckError } from "./workflowPreflightDependencies";
import type { WorkflowPreflightDependencyService } from "./workflowPreflightDependencyService";
import type { PreflightRequestContext, WorkflowPreflightExecutionRow } from "./workflowPreflightExecutionRepository";
import type { DataTransaction } from "./database";
import { operationInputDigest } from "./receipts";
type State = { row: WorkflowPreflightExecutionRow | null; association: { workflowPreflightId: string; executionOwner: boolean; inputSha256: string } | null; receipt: unknown; commits: string[][] };
let state: State, current: string[], uncertain = false;
const input = { workspace_id: "workspace", deck_id: "deck", binding_revision: 7, input_json: '{"negative":-0.0,"integer":9007199254740993,"浮点":1e-7}' };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const binding = { deck_plugin_id: "plugin", deck_plugin_version: "1.0.0", runtime_plugin_lock_id: "lock", deck_runtime_profile_id: "profile",
  deck_runtime_snapshot_contract: "contract", manifest_hash: `sha256:${"a".repeat(64)}`, workflow_definition_ref: "workflow", input_schema_ref: "schema://input", output_schema_ref: "schema://output", required_runtime_plugins: [] };
const snapshot = { deck_runtime_snapshot_id: "snapshot", sanitized_summary_hash: `sha256:${"b".repeat(64)}`, reused: false };
async function transaction<T>(action: (tx: DataTransaction) => Promise<T>) {
  const before = structuredClone(state); current = [];
  try { const result = await action({} as DataTransaction); state.commits.push([...current]);
    if (uncertain && current.includes("passed")) { uncertain = false; throw new Error("Commit outcome unavailable"); }
    return result;
  } catch (error) { if (!current.includes("passed") || !state.receipt) state = before; throw error; }
}
function service() { return new WorkflowPreflightExecutionService(transaction, () => mocks.deps as unknown as WorkflowPreflightDependencyService); }
function run() { return service().execute("service", principal, "original", input); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", "0123456789abcdef0123456789abcdef"); vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000"); vi.stubEnv("DREAM_PREFLIGHT_TOKEN_TTL_SECONDS", "300");
  state = { row: null, association: null, receipt: null, commits: [] }; current = []; uncertain = false;
  mocks.repo.clock.mockResolvedValue("2026-09-15 00:00:00.123456+00"); mocks.repo.active.mockResolvedValue(null);
  mocks.repo.association.mockImplementation((context: PreflightRequestContext) => {
    if (state.association && state.association.inputSha256 !== context.inputSha256) throw new WorkflowPreflightCheckError("OPERATION_REQUEST_CONFLICT");
    return state.association;
  });
  mocks.repo.reserve.mockImplementation((context: PreflightRequestContext, id: string, owner: boolean) => { current.push("reserve"); state.association = { workflowPreflightId: id, executionOwner: owner, inputSha256: context.inputSha256 }; });
  mocks.repo.read.mockImplementation(() => structuredClone(state.row));
  mocks.repo.checking.mockImplementation((context: PreflightRequestContext, id: string, fingerprint: string, hash: string, now: string, expiry: string) => {
    current.push("checking"); state.row = { workflow_preflight_id: id, request_fingerprint: fingerprint, deck_id: context.input.deck_id!,
      binding_revision: context.input.binding_revision!, input_hash: hash, status: "checking", deck_plugin_id: "unresolved", deck_plugin_version: "unresolved",
      runtime_plugin_lock_id: "unresolved", deck_runtime_profile_id: "unresolved", deck_runtime_snapshot_id: null, deck_runtime_snapshot_summary_hash: null,
      error_code: null, failed_check: null, expires_at: expiry, preflight_token_hash: null, consumed_at: null, created_by: context.canonicalUserId, created_at: now, updated_at: now };
  });
  mocks.repo.binding.mockImplementation((_context: unknown, _id: string, facts: typeof binding) => { current.push("binding"); Object.assign(state.row!, { deck_plugin_id: facts.deck_plugin_id, deck_plugin_version: facts.deck_plugin_version, runtime_plugin_lock_id: facts.runtime_plugin_lock_id, deck_runtime_profile_id: facts.deck_runtime_profile_id }); });
  mocks.repo.snapshot.mockImplementation((_context: unknown, _id: string, facts: typeof snapshot) => { current.push("snapshot_binding"); Object.assign(state.row!, { deck_runtime_snapshot_id: facts.deck_runtime_snapshot_id, deck_runtime_snapshot_summary_hash: facts.sanitized_summary_hash }); });
  mocks.repo.passed.mockImplementation((_context: unknown, _id: string, _facts: unknown, hash: string, expiry: string) => { current.push("passed"); Object.assign(state.row!, { status: "passed", preflight_token_hash: hash, expires_at: expiry }); });
  mocks.repo.failed.mockImplementation((_context: unknown, _id: string, check: string, code: string) => { current.push("failed"); Object.assign(state.row!, { status: "failed", failed_check: check, error_code: code, preflight_token_hash: null }); });
  mocks.find.mockImplementation(() => state.receipt ? { inputSha256: state.association!.inputSha256, result: state.receipt, threadScope: null, editorSessionScope: null, runScope: null } : null);
  mocks.receiptExecute.mockImplementation(async (_operation: string, _request: string, rawInput: unknown, output: import("zod").z.ZodType, action: () => Promise<unknown>) => {
    if (state.receipt) { if (state.association?.inputSha256 !== operationInputDigest(rawInput)) throw new WorkflowPreflightCheckError("OPERATION_REQUEST_CONFLICT"); return output.parse(state.receipt); }
    const result = output.parse(await action()); state.receipt = result; current.push("receipt", "audit"); return result;
  });
  for (const fn of Object.values(mocks.deps)) fn.mockResolvedValue(true);
  mocks.deps.binding.mockResolvedValue(binding); mocks.deps.snapshot.mockImplementation(() => { current.push("snapshot"); return snapshot; });
});
afterEach(() => vi.unstubAllEnvs());
describe("original staged Preflight execution", () => {
  it("retains four prior commits and makes final status/token hash/encrypted receipt atomic", async () => {
    const result = await run();
    expect(result.preflight.status).toBe("passed"); expect(result.preflight.preflight_token).toMatch(/^pft_/);
    expect(result.preflight.expires_at).toBe("2026-09-15T00:05:00.123456+00:00");
    expect(state.commits).toEqual([["checking", "reserve"], ["binding"], ["snapshot"], ["snapshot_binding"], ["passed", "receipt", "audit"]]);
    expect(JSON.stringify(state.receipt)).not.toContain(result.preflight.preflight_token);
    expect(state.row?.preflight_token_hash).toMatch(/^sha256:/);
    expect(mocks.deps.manifest).toHaveBeenCalledWith(binding, input.input_json);
  });
  it.each(["identity", "binding", "manifest", "compatibility", "capabilities", "snapshot", "materialization"])("persists %s first failure and preserves earlier stage commits", async name => {
    mocks.deps[name].mockRejectedValueOnce(new WorkflowPreflightCheckError("SAFE_SOURCE_FAILURE"));
    const result = await run(); expect(result.preflight.status).toBe("failed"); expect(result.preflight.error_code).toBe("SAFE_SOURCE_FAILURE"); expect(result.preflight.preflight_token).toBeNull();
    const check = { identity: "identity_workspace_permission", binding: "binding_release", manifest: "manifest_workflow_schema", compatibility: "host_agent_runtime_compatibility", capabilities: "capability_source_policy", snapshot: "deck_runtime_snapshot", materialization: "runtime_materialization" }[name];
    expect(result.preflight.failed_check).toBe(check); expect(state.commits[0]).toEqual(["checking", "reserve"]);
    if (["manifest", "compatibility", "capabilities", "snapshot", "materialization"].includes(name)) expect(result.preflight.deck_plugin_id).toBe("plugin");
    if (name === "materialization") expect(result.preflight.deck_runtime_snapshot_id).toBe("snapshot");
    if (name !== "materialization") expect(mocks.deps.materialization).not.toHaveBeenCalled();
  });
  it("keeps committed snapshot metadata when its separate Preflight-binding stage rolls back", async () => {
    mocks.repo.snapshot.mockRejectedValueOnce(new Error("Unavailable persist stage"));
    const result = await run(); expect(result.preflight.failed_check).toBe("deck_runtime_snapshot");
    expect(state.commits.some(items => items.includes("snapshot"))).toBe(true); expect(result.preflight.deck_runtime_snapshot_id).toBeNull();
  });
  it("maps unexpected dependency failures to the original safe default", async () => {
    mocks.deps.compatibility.mockRejectedValueOnce(new Error("Private provider data")); const result = await run();
    expect(result.preflight.error_code).toBe("CLAUDE_AGENT_INCOMPATIBLE"); expect(JSON.stringify(result)).not.toContain("Private");
  });
  it("recovers committed original response without new checks or TTL and rejects changed input", async () => {
    const original = await run(), counts = Object.fromEntries(Object.entries(mocks.deps).map(([key, fn]) => [key, fn.mock.calls.length]));
    mocks.repo.clock.mockResolvedValue("2099-01-01 00:00:00+00"); expect(await run()).toEqual(original);
    expect(Object.fromEntries(Object.entries(mocks.deps).map(([key, fn]) => [key, fn.mock.calls.length]))).toEqual(counts);
    await expect(service().execute("service", principal, "original", { ...input, input_json: "{}" })).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT" });
  });
  it("returns in-progress evidence after an earlier checking commit without auto-resuming an orphan", async () => {
    const blocked = new Promise<never>(() => {}); mocks.deps.identity.mockReturnValueOnce(blocked);
    const first = run(); void first;
    await vi.waitFor(() => expect(state.association).not.toBeNull());
    const recovered = await run(); expect(recovered.request_state).toBe("in_progress"); expect(recovered.preflight.status).toBe("checking");
    expect(mocks.deps.identity).toHaveBeenCalledTimes(1); expect(state.receipt).toBeNull();
  });
  it("recovers a successful uncertain final commit before any failure mutation", async () => {
    uncertain = true; const result = await run(); expect(result.preflight.status).toBe("passed"); expect(mocks.repo.failed).not.toHaveBeenCalled();
  });
  it("reuses a passed fingerprint with a new bounded request receipt and skips all checks", async () => {
    const original = await run(); state.association = null; state.receipt = null; state.commits = [];
    mocks.repo.active.mockResolvedValue(original.preflight.workflow_preflight_id); vi.clearAllMocks();
    const result = await run(); expect(result).toEqual(original); expect(state.association?.executionOwner).toBe(false);
    expect(mocks.deps.binding).not.toHaveBeenCalled(); expect(mocks.repo.checking).not.toHaveBeenCalled();
  });
  it("fails scope, actor patches, malformed JSON and missing secret configuration before checking", async () => {
    for (const changed of [{ ...input, actor: "other" }, { ...input, input_json: "[]" }, { ...input, input_json: "null" }, { ...input, input_json: '{"v":NaN}' }]) expect(workflowPreflightExecutionInputDto.safeParse(changed).success).toBe(false);
    await expect(service().execute("service", { ...principal, scopes: [] }, "original", input)).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", ""); expect(() => service()).toThrow(); expect(mocks.repo.checking).not.toHaveBeenCalled();
  });
});
