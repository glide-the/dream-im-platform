// [Input] Registry108 strict DTO, fixed actor/policy and mocked typed Repository/receipt UOW seams.
// [Output] Atomic activation, replay, authorization, evidence and idempotency-scope assertions.
// [Pos] Provider-free DTO-Service-ORM domain test; no PostgreSQL, filesystem or Runtime process.
// [Sync] 2026-09-17: cover full launch manifests whose verified Deck refs extend the Runtime lock.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ownedRun: vi.fn(), runtimeLock: vi.fn(), readyInstallation: vi.fn(), materializationByKey: vi.fn(),
  insertMaterialization: vi.fn(), refreshMaterialization: vi.fn(), matchingMaterializations: vi.fn(),
  activeSession: vi.fn(), clock: vi.fn(), nextAttempt: vi.fn(), insertReceipt: vi.fn(),
  markMaterializationsLoaded: vi.fn(), insertCreatingSession: vi.fn(), recordRemoteStart: vi.fn(),
  activateSession: vi.fn(), activateRun: vi.fn(), appendTransition: vi.fn(),
  receiptExecute: vi.fn(), canonicalBusinessJson: vi.fn(),
}));
vi.mock("./workflowRuntimeActivationRepository", () => ({
  WorkflowRuntimeActivationRepository: class {
    ownedRun = mocks.ownedRun; runtimeLock = mocks.runtimeLock; readyInstallation = mocks.readyInstallation;
    materializationByKey = mocks.materializationByKey; insertMaterialization = mocks.insertMaterialization;
    refreshMaterialization = mocks.refreshMaterialization; matchingMaterializations = mocks.matchingMaterializations;
    activeSession = mocks.activeSession; clock = mocks.clock; nextAttempt = mocks.nextAttempt;
    insertReceipt = mocks.insertReceipt; markMaterializationsLoaded = mocks.markMaterializationsLoaded;
    insertCreatingSession = mocks.insertCreatingSession; recordRemoteStart = mocks.recordRemoteStart;
    activateSession = mocks.activateSession; activateRun = mocks.activateRun; appendTransition = mocks.appendTransition;
  },
}));
vi.mock("./receipts", () => ({
  ReceiptRepository: class { execute(...args: unknown[]) { return mocks.receiptExecute(...args); } },
}));
vi.mock("./deckContentCanonical", () => ({ canonicalBusinessJson: mocks.canonicalBusinessJson }));

import type { DataTransaction } from "./database";
import { configuredWorkflowRuntimeActivationPolicy, runWorkflowRuntimeActivationOperation } from "./workflowRuntimeActivationService";
import { workflowRuntimeActivationInputDto, workflowRuntimeActivationOutputDto, type WorkflowRuntimeActivationPolicy } from "./workflowRuntimeActivationDto";

const workflowRunId = `run_${"a".repeat(32)}`;
const lockId = `rpl_${"b".repeat(32)}`;
const digest = `sha256:${"c".repeat(64)}`;
const threadId = "thread-1";
const policy: WorkflowRuntimeActivationPolicy = {
  runtime_environment_id: "ink-local", runtime_pool_id: "ink-local", runtime_node_id: "local",
  distribution_mode: "local_persistent", deployment_tier: "local", policy_revision: "dream-launch/v1",
  materialization_key_scope: "dream-launch", session_creating_lease_seconds: 30,
  required_plugin_id: "ink-dream-story@platform-builtin",
  required_plugin_version: "1.0.0", required_source_type: "platform-builtin",
};
const input = { thread_id: threadId, workflow_run_id: workflowRunId, remote_session_ref: "sdk-thread",
  verified_plugins: [{ package_spec: policy.required_plugin_id, resolved_version: policy.required_plugin_version,
    artifact_digest: digest, has_manifest: true }] };
const deckPlugin = { package_spec: "drama-forge@drama-studio", resolved_version: "1.0.1",
  artifact_digest: `sha256:${"7".repeat(64)}`, has_manifest: true };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" }, threadScope: threadId, runScope: workflowRunId };
const baseRun = { workflow_run_id: workflowRunId, workspace_id: "workspace-1", runtime_plugin_lock_id: lockId,
  deck_plugin_id: "ink-dream-story", deck_plugin_version: "1.0.0",
  deck_plugin_manifest_hash: `sha256:${"d".repeat(64)}`,
  runtime_load_receipt_id: null, agent_session_id: null, source_voice_thread_id: threadId, status: "queued",
  status_version: 2, created_by: "42", started_at: null, completed_at: null };
const lock = { runtime_plugin_lock_id: lockId, deck_plugin_id: "ink-dream-story", deck_plugin_version: "1.0.0",
  deck_plugin_manifest_hash: `sha256:${"d".repeat(64)}`, claude_code_plugins: [{
    claude_code_plugin_id: policy.required_plugin_id, resolved_version: policy.required_plugin_version,
    source_ref: "/srv/ink-dream-story", artifact_digest: digest, required: true,
    capability_bindings: ["Skill", "Read", "Skill"],
  }], created_at: "2026-09-15T00:00:00+00:00", production_ready: true, production_readiness_reasons: [] };
const tx = {} as DataTransaction;

function materialization(artifactSetHash: string) {
  return { runtime_materialization_id: `rm_${"e".repeat(32)}`, runtime_environment_id: policy.runtime_environment_id,
    runtime_pool_id: policy.runtime_pool_id, runtime_node_id: policy.runtime_node_id,
    claude_code_plugin_id: policy.required_plugin_id, resolved_version: policy.required_plugin_version,
    artifact_digest: digest, materialized_digest: digest, artifact_set_hash: artifactSetHash,
    policy_revision: policy.policy_revision, declaration_status: "declared", materialization_status: "materialized",
    activation_status: "loadable", verification_status: "verified", signature_bundle_ref: null,
    retention_state: "shared_artifact", restore_source_ref: null };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ownedRun.mockResolvedValue(baseRun); mocks.runtimeLock.mockResolvedValue({ id: lockId, lock_json: lock });
  mocks.readyInstallation.mockResolvedValue({ id: "installation", artifact_path: "/admin/artifacts/adapter",
    requested_package_spec: policy.required_plugin_id, resolved_version: policy.required_plugin_version,
    artifact_digest: digest, source_type: "platform-builtin", status: "ready" });
  mocks.materializationByKey.mockResolvedValue(null);
  mocks.matchingMaterializations.mockImplementation(async (_policy, artifactSetHash) => [materialization(artifactSetHash)]);
  mocks.clock.mockResolvedValue("2026-09-15 00:00:00.123456+00"); mocks.nextAttempt.mockResolvedValue(1);
  mocks.recordRemoteStart.mockResolvedValue(true); mocks.activateSession.mockResolvedValue(true);
  mocks.activateRun.mockResolvedValue(true); mocks.canonicalBusinessJson.mockResolvedValue({ content_hash: `sha256:${"f".repeat(64)}` });
  mocks.receiptExecute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
});
afterEach(() => vi.unstubAllEnvs());

it("accepts the exact DTO and commits materialization, receipt, Session, Run and history through one receipt UOW", async () => {
  const result = await runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "dream-service", "request-1", tx, policy);
  expect(result).toMatchObject({ thread_id: threadId, workflow_run_id: workflowRunId, workspace_id: "workspace-1",
    runtime_plugin_lock_id: lockId, status: "running", replayed: false });
  expect(workflowRuntimeActivationOutputDto.safeParse(result).success).toBe(true);
  expect(mocks.ownedRun).toHaveBeenCalledExactlyOnceWith("42", input);
  expect(mocks.receiptExecute).toHaveBeenCalledWith("workflow-runtime.activate", "request-1", input,
    workflowRuntimeActivationOutputDto, expect.any(Function), threadId, null, workflowRunId);
  expect(mocks.insertMaterialization).toHaveBeenCalledWith(expect.objectContaining({
    runtime_environment_id: policy.runtime_environment_id, runtime_node_id: policy.runtime_node_id,
    claude_code_plugin_id: policy.required_plugin_id, cache_ref: "/admin/artifacts/adapter",
  }));
  expect(mocks.insertReceipt).toHaveBeenCalledWith(expect.objectContaining({ workflow_run_id: workflowRunId,
    runtime_plugin_lock_id: lockId, required_entries_ready: 1 }), [expect.objectContaining({
      claude_code_plugin_id: policy.required_plugin_id, loaded_capabilities_json: '["Read","Skill"]', load_status: "loaded",
  })]);
  expect(mocks.insertCreatingSession).toHaveBeenCalledWith(expect.objectContaining({ workflow_run_id: workflowRunId,
    runtime_plugin_lock_id: lockId, remote_session_ref: null, status: "creating",
    owner_token: expect.stringMatching(/^[0-9a-f]{32}$/) }), policy.session_creating_lease_seconds);
  const ownerToken = mocks.insertCreatingSession.mock.calls[0][0].owner_token;
  expect(mocks.recordRemoteStart).toHaveBeenCalledWith(expect.stringMatching(/^as_[0-9a-f]{32}$/), ownerToken, "sdk-thread");
  expect(mocks.activateSession).toHaveBeenCalledWith(expect.stringMatching(/^as_[0-9a-f]{32}$/), ownerToken,
    "2026-09-15T00:00:00.123456+00:00");
  expect(mocks.activateRun).toHaveBeenCalledWith(baseRun, expect.stringMatching(/^rlr_[0-9a-f]{32}$/),
    expect.stringMatching(/^as_[0-9a-f]{32}$/), "2026-09-15T00:00:00.123456+00:00");
  expect(mocks.appendTransition).toHaveBeenCalledWith(workflowRunId, 3, "42", "2026-09-15T00:00:00.123456+00:00");
  expect(mocks.insertReceipt.mock.invocationCallOrder[0]).toBeLessThan(mocks.insertCreatingSession.mock.invocationCallOrder[0]);
  expect(mocks.insertCreatingSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.recordRemoteStart.mock.invocationCallOrder[0]);
  expect(mocks.recordRemoteStart.mock.invocationCallOrder[0]).toBeLessThan(mocks.activateSession.mock.invocationCallOrder[0]);
  expect(mocks.activateSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.activateRun.mock.invocationCallOrder[0]);
  expect(mocks.activateRun.mock.invocationCallOrder[0]).toBeLessThan(mocks.appendTransition.mock.invocationCallOrder[0]);
});

it("accepts verified Deck refs outside the Runtime lock without persisting them as Runtime dependencies", async () => {
  const completeManifest = { ...input, verified_plugins: [deckPlugin, ...input.verified_plugins] };
  const result = await runWorkflowRuntimeActivationOperation(
    "workflow-runtime.activate", completeManifest, actor, "dream-service", "request-deck-ref", tx, policy,
  );
  expect(result).toMatchObject({ workflow_run_id: workflowRunId, status: "running" });
  expect(mocks.ownedRun).toHaveBeenCalledExactlyOnceWith("42", completeManifest);
  expect(mocks.insertMaterialization).toHaveBeenCalledTimes(1);
  expect(mocks.insertMaterialization).toHaveBeenCalledWith(expect.objectContaining({
    claude_code_plugin_id: policy.required_plugin_id,
  }));
  expect(mocks.insertReceipt).toHaveBeenCalledWith(expect.any(Object), [expect.objectContaining({
    claude_code_plugin_id: policy.required_plugin_id,
  })]);
});

it("revalidates active bindings and replays without installation or durable writes", async () => {
  const active = { ...baseRun, status: "running", runtime_load_receipt_id: `rlr_${"1".repeat(32)}`,
    agent_session_id: `as_${"2".repeat(32)}`, started_at: "2026-09-15T00:00:00+00:00" };
  mocks.ownedRun.mockResolvedValue(active); mocks.activeSession.mockResolvedValue({ agent_session_id: active.agent_session_id,
    workflow_run_id: workflowRunId, runtime_load_receipt_id: active.runtime_load_receipt_id,
    runtime_plugin_lock_id: lockId, remote_session_ref: input.remote_session_ref, status: "active" });
  expect(await runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "dream-service", "request-2", tx, policy))
    .toEqual({ thread_id: threadId, workflow_run_id: workflowRunId, workspace_id: "workspace-1",
      runtime_plugin_lock_id: lockId, runtime_load_receipt_id: active.runtime_load_receipt_id,
      agent_session_id: active.agent_session_id, status: "running", replayed: true });
  expect(mocks.readyInstallation).not.toHaveBeenCalled(); expect(mocks.insertReceipt).not.toHaveBeenCalled();
  expect(mocks.insertCreatingSession).not.toHaveBeenCalled(); expect(mocks.activateRun).not.toHaveBeenCalled();
});

it("rejects caller selectors, blank runtime references and mismatched delegation before ORM access", async () => {
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "runtime_node_id", "path"])
    expect(workflowRuntimeActivationInputDto.safeParse({ ...input, [key]: "caller" }).success).toBe(false);
  expect(workflowRuntimeActivationInputDto.safeParse({ ...input, remote_session_ref: "   " }).success).toBe(false);
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input,
    { ...actor, runScope: `run_${"9".repeat(32)}` }, "dream-service", "request", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  expect(mocks.ownedRun).not.toHaveBeenCalled();
});

it("fails closed for missing ownership, altered workspace evidence, installation and Run CAS", async () => {
  mocks.ownedRun.mockResolvedValueOnce(null);
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "missing", tx, policy))
    .rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
  mocks.runtimeLock.mockResolvedValueOnce({ id: lockId, lock_json: { ...lock, runtime_plugin_lock_id: `rpl_${"0".repeat(32)}` } });
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "lock", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_RUNTIME_NOT_READY", status: 409 });
  mocks.readyInstallation.mockResolvedValueOnce(null);
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "install", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_RUNTIME_NOT_READY", status: 409 });
  mocks.activateRun.mockResolvedValueOnce(false);
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "cas", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_RUNTIME_NOT_READY", status: 409 });
});

it("rejects duplicate, missing or tampered verified plugin evidence", async () => {
  const variants = [
    { ...input, verified_plugins: [...input.verified_plugins, input.verified_plugins[0]] },
    { ...input, verified_plugins: [deckPlugin, deckPlugin] },
    { ...input, verified_plugins: [deckPlugin] },
    { ...input, verified_plugins: [] },
    { ...input, verified_plugins: [{ ...input.verified_plugins[0], artifact_digest: `sha256:${"9".repeat(64)}` }] },
    { ...input, verified_plugins: [{ ...input.verified_plugins[0], has_manifest: false }] },
    { ...input, verified_plugins: [...input.verified_plugins, { ...deckPlugin, has_manifest: false }] },
  ];
  for (const value of variants) await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", value,
    actor, "service", "evidence", tx, policy)).rejects.toMatchObject({ code: "DREAM_RUNTIME_INIT_INVALID", status: 409 });
  expect(mocks.readyInstallation).not.toHaveBeenCalled();
});

it("rejects a new replay request whose observed SDK Thread differs from the active Session", async () => {
  const active = { ...baseRun, status: "running", runtime_load_receipt_id: `rlr_${"1".repeat(32)}`,
    agent_session_id: `as_${"2".repeat(32)}`, started_at: "2026-09-15T00:00:00+00:00" };
  mocks.ownedRun.mockResolvedValue(active); mocks.activeSession.mockResolvedValue({ agent_session_id: active.agent_session_id,
    workflow_run_id: workflowRunId, runtime_load_receipt_id: active.runtime_load_receipt_id,
    runtime_plugin_lock_id: lockId, remote_session_ref: "other-sdk-thread", status: "active" });
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "active-ref", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_RUNTIME_INIT_INVALID", status: 409 });
});

it("rejects a frozen lock whose Deck identity differs from the Run", async () => {
  mocks.runtimeLock.mockResolvedValueOnce({ id: lockId, lock_json: { ...lock, deck_plugin_version: "1.0.1" } });
  await expect(runWorkflowRuntimeActivationOperation("workflow-runtime.activate", input, actor, "service", "lock-run", tx, policy))
    .rejects.toMatchObject({ code: "DREAM_RUNTIME_NOT_READY", status: 409 });
  expect(mocks.readyInstallation).not.toHaveBeenCalled();
});

it("loads only a strict configured Admin placement policy", () => {
  vi.stubEnv("DREAM_RUNTIME_ACTIVATION_POLICY_JSON", JSON.stringify(policy));
  expect(configuredWorkflowRuntimeActivationPolicy()).toEqual(policy);
  vi.stubEnv("DREAM_RUNTIME_ACTIVATION_POLICY_JSON", JSON.stringify({ ...policy, runtime_pool_id: "other" }));
  expect(() => configuredWorkflowRuntimeActivationPolicy()).toThrowError(expect.objectContaining({ code: "DREAM_RUNTIME_POLICY_NOT_CONFIGURED" }));
});
