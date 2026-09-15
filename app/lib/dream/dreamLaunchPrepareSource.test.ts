// [Input] Actual whole prepare/replay/Agent-scope adapter with fixed rows and captured named collaborators.
// [Output] Twenty-three complete result/parameter/order vectors including rollback-before-catalog and replay bypass.
// [Pos] Source-only evidence; catalog eligibility, current-scope SQL and runtime/binding provisioning are captured.
// [Sync] 2026-09-15: run source parity only when both explicit Dream source and oracle interpreter are available.
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { dreamLaunchSourceIdentity, dreamLaunchSourceEnvelope } from "./dreamLaunchSourceSemantics";
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE || !process.env.INK_DREAM_ORACLE_PYTHON)("matches twenty-three full actual prepare/replay/Agent-scope vectors without real catalog, SQL or provisioning", async () => {
  const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;
  expect(sourceRoot).toBeTruthy(); expect(python).toBeTruthy(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const base = validWorkflowRun(), actor = base.created_by, workspace = base.workspace_id, deck = "deck", agent = "agent";
  const command = { deck_id: deck, agent_id: null as string | null, goal: "准备验证😀", idempotency_key: "prepare-source" };
  const input = { workspace_id: workspace, ...command }, identity = await dreamLaunchSourceIdentity(actor, input);
  const metadata = JSON.parse(dreamLaunchSourceEnvelope(actor, input, identity.requestFingerprint).metadata) as Record<string, unknown>;
  const { workflow_run_id: id, ...fields } = base;
  const raw = { ...fields, id, idempotency_key: command.idempotency_key, preflight_deck_id: deck, source_voice_thread_id: identity.threadId, source_message_id: identity.messageId,
    source_message_time: base.created_at };
  const storedSource = { message_id: identity.messageId, thread_id: identity.threadId, user_id: actor, deck_id: deck, voice_id: null,
    metadata: JSON.stringify(metadata) };
  const binding = { deck_plugin_id: base.deck_plugin_id, deck_plugin_version: base.deck_plugin_version,
    deck_plugin_binding_id: base.deck_plugin_binding_id, binding_revision: base.binding_revision };
  const query = [workspace, actor, command.idempotency_key], sourceQuery = [identity.messageId, identity.threadId];
  function request(rows: unknown[], agentId: string | null = null, controls: Record<string, unknown> = {}) {
    return { actor, workspace, command: { ...command, agent_id: agentId }, rows, binding, ...controls };
  }
  const defaults = { result: binding as unknown, error: null as unknown, parameters: [query] as unknown[], events: ["execute", "rollback", "catalog", "binding"],
    rollbacks: 1, in_transaction: false, catalog_arguments: [[actor, null]] as unknown[], scope_arguments: [] as unknown[], frozen_arguments: [] as unknown[],
    binding_arguments: [{ deck_id: deck, actor_id: actor, workspace_id: workspace }] as unknown[], existing_run: null as unknown,
    actor_context: { actor_id: actor, workspace_id: workspace } };
  const expected = (changes: Record<string, unknown> = {}) => ({ ...defaults, ...changes });
  const applicationError = (code: string, status: number) => ({ class: "DreamLaunchApplicationError", code, status });
  const replay = { parameters: [query, sourceQuery], events: ["execute", "execute", "current_scope", "frozen_evidence"], rollbacks: 0, in_transaction: true,
    catalog_arguments: [], scope_arguments: [[deck, actor, workspace]], frozen_arguments: [base.runtime_plugin_lock_id], binding_arguments: [], existing_run: raw };
  const conflict = { ...replay, result: null, error: { class: "DreamLaunchIdempotencyConflict", code: "DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", status: null },
    events: ["execute", "execute"], scope_arguments: [], frozen_arguments: [], existing_run: null };
  const vectors: { input: Record<string, unknown>; output: Record<string, unknown> }[] = [
    { input: request([null]), output: expected() },
    { input: request([{ id: agent }, null], agent), output: expected({ parameters: [[agent, deck], query], events: ["execute", "execute", "rollback", "catalog", "binding"] }) },
    { input: request([null], null, { model_error: true }), output: expected({ result: null, error: applicationError("MODEL_SCOPE_DENIED", 403), events: ["execute", "rollback", "catalog"], binding_arguments: [] }) },
    { input: request([null], agent), output: expected({ result: null, error: applicationError("AGENT_ACCESS_DENIED", 404), parameters: [[agent, deck]], events: ["execute"], rollbacks: 0,
      in_transaction: true, catalog_arguments: [], binding_arguments: [] }) },
    { input: request([raw, storedSource], null, { model_error: true }), output: expected(replay) },
  ];
  const agentInput = { ...input, agent_id: agent }, agentIdentity = await dreamLaunchSourceIdentity(actor, agentInput);
  const agentMetadata = JSON.parse(dreamLaunchSourceEnvelope(actor, agentInput, agentIdentity.requestFingerprint).metadata);
  const agentSource = { ...storedSource, voice_id: agent, metadata: JSON.stringify(agentMetadata) };
  vectors.push({ input: request([{ id: agent }, raw, agentSource], agent, { model_error: true }), output: expected({ ...replay,
    parameters: [[agent, deck], query, sourceQuery], events: ["execute", "execute", "execute", "current_scope", "frozen_evidence"] }) });
  vectors.push({ input: request([raw, null]), output: expected(conflict) });
  vectors.push({ input: request([{ ...raw, preflight_deck_id: "other" }, storedSource]), output: expected(conflict) });
  for (const field of ["thread_id", "message_id", "user_id", "deck_id", "voice_id"])
    vectors.push({ input: request([raw, { ...storedSource, [field]: "other" }]), output: expected(conflict) });
  for (const field of ["kind", "actorId", "workspaceId", "deckId", "agentId", "goal", "idempotencyKey", "requestFingerprint"])
    vectors.push({ input: request([raw, { ...storedSource, metadata: JSON.stringify({ ...metadata, [field]: "other" }) }]), output: expected(conflict) });
  vectors.push({ input: request([raw, storedSource], null, { scope_error: true }), output: expected({ ...replay, result: null, error: { class: "PermissionError", code: null, status: null },
    events: ["execute", "execute", "current_scope"], frozen_arguments: [] }) });
  vectors.push({ input: request([raw, storedSource], null, { frozen_error: true }), output: expected({ ...replay, result: null, error: applicationError("RUNTIME_PLUGIN_NOT_READY", 503) }) });
  expect(vectors).toHaveLength(23);
  const child = spawnSync(python!, ["-B", "tests/integration/dreamLaunchPrepareOracle.py"], { encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv, input: JSON.stringify({ cases: vectors.map(item => item.input) }) });
  expect(child.error, "Actual source interpreter must be available").toBeUndefined(); expect(child.status, "Actual source adapter must finish without printing stderr/body").toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(vectors.map(item => item.output));
});
