// [Input] Original _create_run and Admin creation on the same fixed facts, clock and injected UUID sequence.
// [Output] Full queued Run and original INSERT/consumption/transition parameter parity with one creation commit.
// [Pos] Provider-free actual-source atomic contract; fixed positional reads do not interpret or execute SQL.
// [Sync] 2026-09-15: independently compare fresh creation and both semantic replay paths before registration.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ uuid: vi.fn(), read: vi.fn(), find: vi.fn(), receipt: vi.fn(),
  repo: Object.fromEntries(["lockKey", "assertWorkspace", "context", "source", "tokenConsumption", "scopedRun", "clock", "insertRun", "consume", "queue", "append"].map(key => [key, vi.fn()])) }));
vi.mock("node:crypto", async original => ({ ...await original<typeof import("node:crypto")>(), randomUUID: mocks.uuid }));
vi.mock("./workflowRunCreationRepository", () => ({ WorkflowRunCreationRepository: class {
  runs = { read: mocks.read };
  constructor() { for (const [key, method] of Object.entries(mocks.repo)) Object.assign(this, { [key]: method }); }
} }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; execute = mocks.receipt; } }));
import { z } from "zod";
import type { DataTransaction } from "./database";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { WorkflowRunCreationService } from "./workflowRunCreationService";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import type { WorkflowRunCreationContext } from "./workflowRunCreationRepository";
import { analyzeWorkflowRunCreation } from "./workflowRunCreationSemantics";
import { workflowRunReadOutputDto } from "./workflowRunDto";
const secret = "0123456789abcdef0123456789abcdef", now = "2026-09-14T00:00:00.123455+00:00";
const source = { source_voice_thread_id: null, source_message_id: null, source_message_time: null };
const identifiers = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", secret); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000"); });
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual atomic-create fields, token mapping, transitions and both original replays", async () => {
  const template = validWorkflowRun(), pf = validWorkflowPreflightRow();
  const context: WorkflowRunCreationContext = { ...pf, workflow_preflight_id: template.workflow_preflight_id,
    input_hash: template.input_hash, binding_revision: template.binding_revision, runtime_plugin_lock_id: template.runtime_plugin_lock_id,
    deck_runtime_snapshot_id: template.deck_runtime_snapshot_id, request_fingerprint: template.input_hash, updated_at: pf.created_at,
    deck_plugin_binding_id: template.deck_plugin_binding_id, binding_workspace_id: template.workspace_id, binding_creator_id: template.created_by,
    manifest_hash: template.deck_plugin_manifest_hash, lock_manifest_hash: template.deck_plugin_manifest_hash,
    workflow_definition_ref: template.workflow_definition_ref, lock_json: '{"负零":-0.0,"integer":9007199254740993}', preflight_token_hash: null };
  const authority = new WorkflowTokenAuthority(Buffer.from(secret)), token = authority.issueStored({ ...context, deck_runtime_snapshot_id: context.deck_runtime_snapshot_id! });
  context.preflight_token_hash = authority.tokenHash(token);
  const semantics = await analyzeWorkflowRunCreation(context, source, null);
  const queued = { ...template, workflow_run_id: `run_${identifiers[0]}`, idempotency_key: "business_key", semantic_fingerprint: semantics.fingerprint, created_at: now };
  const { workflow_run_id, ...storedFields } = queued, storedRow = { ...storedFields, id: workflow_run_id };
  const consumption = { token_digest: authority.consumptionDigest(token), workflow_run_id, workflow_preflight_id: context.workflow_preflight_id,
    workspace_id: queued.workspace_id, actor_id: queued.created_by, idempotency_key: queued.idempotency_key, semantic_fingerprint: semantics.fingerprint };
  for (const mode of ["fresh", "fresh-semantic", "consumed"] as const) {
    const current = { ...context, consumed_at: mode === "consumed" ? now : null };
    // The consumed path intentionally bypasses current expiry, as the original does.
    const clock = mode === "consumed" ? "2030-01-01T00:00:00.000000+00:00" : now;
    const rows = mode === "fresh" ? [null, current, null, null, null, null, null, null, null, null, storedRow]
      : mode === "fresh-semantic" ? [null, current, null, storedRow, null, null] : [null, current, consumption, storedRow];
    const original = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/workflowRunCreationOracle.py")],
      { env: process.env, encoding: "utf8", timeout: 10_000, input: JSON.stringify({ action: "create", rows, secret, clock, uuids: identifiers,
        actor: { actor_id: queued.created_by, workspace_id: queued.workspace_id }, source, token, preflight_id: context.workflow_preflight_id,
        key: queued.idempotency_key, retry_of_run_id: null, expected_retry_source: null }) });
    expect((original.error as NodeJS.ErrnoException | undefined)?.code ?? null, "Atomic source launch must succeed").toBeNull();
    expect(original.status, "Actual original atomic creation must launch").toBe(0);
    const expected = JSON.parse(original.stdout) as { accepted: boolean; run: unknown; parameters: unknown[][]; commits: number; rollbacks: number };
    expect(expected.accepted).toBe(true); expect(expected.commits).toBe(1); expect(expected.rollbacks).toBe(0);
    vi.clearAllMocks(); let index = 0;
    mocks.uuid.mockImplementation(() => identifiers[index++]); mocks.find.mockResolvedValue(null); mocks.repo.context.mockResolvedValue(current);
    mocks.repo.clock.mockResolvedValue(clock); mocks.repo.scopedRun.mockResolvedValue(mode === "fresh" ? null : queued);
    mocks.repo.tokenConsumption.mockResolvedValue(mode === "consumed" ? consumption : null); mocks.read.mockResolvedValue(queued);
    mocks.receipt.mockImplementation(async (_name: string, _request: string, _input: unknown, output: z.ZodType, action: () => Promise<unknown>) => output.parse(await action()));
    let commits = 0;
    const transaction = async <T,>(action: (tx: DataTransaction) => Promise<T>) => { const result = await action({ execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as DataTransaction); commits++; return result; };
    const actual = await new WorkflowRunCreationService(transaction).execute("workflow-run.create", "service",
      { subject: "subject", canonical_user_id: queued.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" }, "original",
      { workspace_id: queued.workspace_id, workflow_preflight_id: context.workflow_preflight_id, preflight_token: token, idempotency_key: queued.idempotency_key, ...source });
    expect(actual).toEqual(workflowRunReadOutputDto.parse({ run: expected.run })); expect(commits).toBe(1);
    if (mode === "fresh") {
      const fields = mocks.repo.insertRun.mock.calls[0][0] as Record<string, unknown>;
      const order = ["id", "workspace_id", "deck_plugin_id", "deck_plugin_version", "workflow_definition_ref", "deck_runtime_snapshot_id", "retry_of_run_id",
        "deck_plugin_manifest_hash", "deck_plugin_binding_id", "binding_revision", "runtime_plugin_lock_id", "workflow_preflight_id",
        "source_voice_thread_id", "source_message_id", "source_message_time", "idempotency_key", "input_hash", "semantic_fingerprint", "created_by", "created_at"];
      expect(order.map(key => fields[key])).toEqual(expected.parameters[4]); expect(fields).toMatchObject({ status: "preflight", status_version: 1 });
      const transitionOrder = ["id", "workflow_run_id", "transition_seq", "from_status", "to_status", "actor_id", "reason_code", "failed_step", "error_code", "occurred_at"];
      mocks.repo.append.mock.calls.forEach(([event], sequence) => expect(transitionOrder.map(key => event[key] ?? null)).toEqual(expected.parameters[sequence === 0 ? 7 : 9]));
      expect(mocks.repo.queue).toHaveBeenCalledExactlyOnceWith(workflow_run_id);
    } else { expect(mocks.repo.insertRun).not.toHaveBeenCalled(); expect(mocks.repo.append).not.toHaveBeenCalled(); expect(mocks.repo.queue).not.toHaveBeenCalled(); }
    if (mode !== "consumed") {
      const [mapped, consumedAt, updatedAt] = mocks.repo.consume.mock.calls[0];
      expect(Object.values(mapped)).toEqual(expected.parameters[mode === "fresh" ? 5 : 4]);
      expect([consumedAt, updatedAt, context.workflow_preflight_id]).toEqual(expected.parameters[mode === "fresh" ? 6 : 5]);
    } else expect(mocks.repo.consume).not.toHaveBeenCalled();
  }
});
