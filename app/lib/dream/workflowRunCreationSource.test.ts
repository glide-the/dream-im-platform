// [Input] Fixed raw context/source/lock/key vectors and an explicit actual Dream source interpreter.
// [Output] Original semantic/token/request/display and explicit source-clock capture parity without a database.
// [Pos] Provider-free creation source gate; public acceptance remains a separate primary-owned stage.
// [Sync] 2026-09-15: validate corrected stored codepoints and minimal-environment clock/retry source capture.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import type { WorkflowRunCreationContext } from "./workflowRunCreationRepository";
import { analyzeWorkflowRunCreation, frozenRunSourceFromRun, type WorkflowRunSource } from "./workflowRunCreationSemantics";
import { workflowRunCreateInputDto, workflowRunCreationKeyDto } from "./workflowRunCreationDto";
import { workflowRunDto, workflowRunKeyDto } from "./workflowRunDto";
const secret = "0123456789abcdef0123456789abcdef";
function oracle(input: unknown, minimalEnvironment = false) {
  const result = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/workflowRunCreationOracle.py")],
    { env: minimalEnvironment ? { PATH: process.env.PATH, INK_DREAM_SOURCE: process.env.INK_DREAM_SOURCE } as unknown as NodeJS.ProcessEnv : process.env,
      encoding: "utf8", timeout: 10_000, input: JSON.stringify(input) });
  expect((result.error as NodeJS.ErrnoException | undefined)?.code ?? null, "Source launch must succeed without exposing stderr or paths").toBeNull();
  expect(result.status, "Actual original Run source must launch").toBe(0);
  return JSON.parse(result.stdout);
}
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual raw frozen source, semantic fingerprint, lock/token digests and signature", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const row = validWorkflowPreflightRow();
  const base: WorkflowRunCreationContext = { ...row, request_fingerprint: row.input_hash, updated_at: row.created_at, preflight_token_hash: null,
    deck_plugin_binding_id: "binding", binding_workspace_id: "workspace", binding_creator_id: row.created_by,
    manifest_hash: row.input_hash, workflow_definition_ref: " flow_中文😀 ", lock_manifest_hash: row.input_hash,
    lock_json: '{"negative":-0.0,"integer":9007199254740993,"中文😀":"组合é"}' };
  const empty: WorkflowRunSource = { source_voice_thread_id: null, source_message_id: null, source_message_time: null };
  const source = { source_voice_thread_id: " source_😀 ", source_message_id: "message_中文", source_message_time: "2026-09-14T08:00:00.123456789+08:00" };
  const authority = new WorkflowTokenAuthority(Buffer.from(secret));
  const cases = [
    { context: base, source: empty, retry_of_run_id: null },
    { context: base, source, retry_of_run_id: null },
    { context: { ...base, runtime_plugin_lock_id: " lock_😀 ", deck_runtime_snapshot_id: " snapshot_中文 " }, source, retry_of_run_id: null },
    { context: { ...base, workflow_preflight_id: `pf_${"f".repeat(32)}` }, source, retry_of_run_id: null },
    { context: base, source: { ...source, source_message_time: "2026-09-14T00:00:00.123456+00:00" }, retry_of_run_id: null },
    { context: base, source, retry_of_run_id: `run_${"b".repeat(32)}` },
    { context: { ...base, lock_json: '{"negative":0.0,"integer":9007199254740993,"中文😀":"组合é"}' }, source, retry_of_run_id: null },
  ].map(value => ({ ...value, token: authority.issueStored({ ...value.context, deck_runtime_snapshot_id: value.context.deck_runtime_snapshot_id! }) }));
  const expected = oracle({ action: "semantics", cases, secret }) as { frozen_source: unknown; fingerprint: string; lock_digest: string; token_digest: string; signature_valid: boolean }[];
  for (const [index, value] of cases.entries()) {
    const actual = await analyzeWorkflowRunCreation(value.context, value.source, value.retry_of_run_id);
    expect(actual).toEqual({ frozenSource: expected[index].frozen_source, fingerprint: expected[index].fingerprint, lockDigest: expected[index].lock_digest });
    expect(authority.consumptionDigest(value.token)).toBe(expected[index].token_digest); expect(expected[index].signature_valid).toBe(true);
  }
  expect(expected[1].fingerprint).toBe(expected[3].fingerprint); expect(cases[1].token).not.toBe(cases[3].token);
  expect(expected[1].fingerprint).toBe(expected[4].fingerprint);
  expect(expected[1].fingerprint).not.toBe(expected[5].fingerprint); expect(expected[1].lock_digest).not.toBe(expected[6].lock_digest);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original request validation for Unicode keys and retains JSON schema maxLength", () => {
  const cases = ["x".repeat(255), "x".repeat(256), "😀".repeat(128), "😀".repeat(255), "😀".repeat(256), "\u001c", "\u00a0 key😀 \u00a0", "\ufeff"];
  const expected = oracle({ action: "request-key", secret, cases: cases.map(idempotency_key => ({ ...validWorkflowRun(), idempotency_key })) }) as { accepted: boolean; key?: string }[];
  cases.forEach((value, index) => {
    const actual = workflowRunCreationKeyDto.safeParse(value);
    expect(actual.success).toBe(expected[index].accepted);
    if (actual.success) expect(actual.data).toBe(expected[index].key);
  });
  expect(z.toJSONSchema(workflowRunCreationKeyDto)).toMatchObject({ type: "string", minLength: 1, maxLength: 255 });
});
it("rejects partial Voice tuples, naive source time and caller-selected actor/frozen/status fields", () => {
  const input = { workspace_id: "workspace", workflow_preflight_id: `pf_${"a".repeat(32)}`, preflight_token: "pft_fixed", idempotency_key: "key",
    source_voice_thread_id: null, source_message_id: null, source_message_time: null };
  expect(workflowRunCreateInputDto.safeParse(input).success).toBe(true);
  expect(workflowRunCreateInputDto.safeParse({ ...input, source_voice_thread_id: "thread" }).success).toBe(false);
  expect(workflowRunCreateInputDto.safeParse({ ...input, source_voice_thread_id: "thread", source_message_id: "message", source_message_time: "2026-09-14T00:00:00" }).success).toBe(false);
  for (const key of ["created_by", "deck_plugin_id", "input_hash", "status"]) expect(workflowRunCreateInputDto.safeParse({ ...input, [key]: "caller" }).success).toBe(false);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual stored display model keys without adding request blank rules", () => {
  const cases = ["x".repeat(255), "x".repeat(256), "😀".repeat(128), "😀".repeat(255), "😀".repeat(256), "\u001c", "\u00a0 key😀 \u00a0", "\ufeff"];
  const expected = oracle({ action: "model-key", cases: cases.map(idempotency_key => ({ ...validWorkflowRun(), idempotency_key })) }) as { accepted: boolean; key?: string }[];
  cases.forEach((idempotency_key, index) => {
    const actual = workflowRunDto.safeParse({ ...validWorkflowRun(), idempotency_key });
    expect(actual.success).toBe(expected[index].accepted);
    if (actual.success) expect(actual.data.idempotency_key).toBe(expected[index].key);
  });
  expect(z.toJSONSchema(workflowRunKeyDto)).toMatchObject({ type: "string", minLength: 1, maxLength: 255 });
  expect(workflowRunKeyDto.safeParse("\u001c").success).toBe(true); expect(workflowRunCreationKeyDto.safeParse("\u001c").success).toBe(false);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual new source clock-sequence and retry-frozen capture without altering default source actions", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const template = validWorkflowRun(), pf = validWorkflowPreflightRow();
  const context: WorkflowRunCreationContext = { ...pf, workflow_preflight_id: template.workflow_preflight_id,
    binding_revision: template.binding_revision, runtime_plugin_lock_id: template.runtime_plugin_lock_id, deck_runtime_snapshot_id: template.deck_runtime_snapshot_id,
    input_hash: template.input_hash, request_fingerprint: template.input_hash, updated_at: pf.created_at, deck_plugin_binding_id: template.deck_plugin_binding_id,
    binding_workspace_id: template.workspace_id, binding_creator_id: template.created_by, manifest_hash: template.deck_plugin_manifest_hash,
    lock_manifest_hash: template.deck_plugin_manifest_hash, workflow_definition_ref: template.workflow_definition_ref, lock_json: "{}", preflight_token_hash: null };
  const source = { source_voice_thread_id: null, source_message_id: null, source_message_time: null }, authority = new WorkflowTokenAuthority(Buffer.from(secret));
  const token = authority.issueStored({ ...context, deck_runtime_snapshot_id: context.deck_runtime_snapshot_id! }); context.preflight_token_hash = authority.tokenHash(token);
  const semantics = await analyzeWorkflowRunCreation(context, source, null), ids = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
  const clocks = ["2026-09-14T00:00:00.123451+00:00", "2026-09-14T00:00:00.123452+00:00", "2026-09-14T00:00:00.123453+00:00", "2026-09-14T00:00:00.123454+00:00"];
  const { workflow_run_id: ignored, ...fields } = { ...template, created_at: clocks[1], semantic_fingerprint: semantics.fingerprint, idempotency_key: "key😀" }; void ignored;
  const row = { ...fields, id: `run_${ids[0]}` };
  const captured = oracle({ action: "create", secret, rows: [null, context, null, null, null, null, null, null, null, null, row], source, token,
    preflight_id: context.workflow_preflight_id, key: row.idempotency_key, actor: { actor_id: row.created_by, workspace_id: row.workspace_id },
    retry_of_run_id: null, expected_retry_source: null, uuids: ids, clock_sequence: clocks }, true);
  expect(captured.accepted).toBe(true); expect(captured.parameters[4].at(-1)).toBe(clocks[1]); expect(captured.parameters[6]).toEqual([clocks[2], clocks[3], context.workflow_preflight_id]);
  expect(captured.parameters[7].at(-1)).toBe(clocks[1]); expect(captured.parameters[9].at(-1)).toBe(clocks[1]); expect([captured.commits, captured.rollbacks]).toEqual([1, 0]);
  expect(oracle({ action: "retry-frozen", row, secret }, true)).toEqual(frozenRunSourceFromRun(workflowRunDto.parse({ ...fields, workflow_run_id: row.id })));
});
