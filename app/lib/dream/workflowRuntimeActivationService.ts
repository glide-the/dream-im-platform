// [Input] Strict Registry108 input, verified actor, configured placement and caller-owned Admin UOW.
// [Output] Idempotent active Runtime binding committed with its receipt in one transaction.
// [Pos] DTO-Service-typed ORM composition; Dream retains byte verification, Agent Runtime and SSE.
// [Sync] 2026-09-15: migrate assembled Story Runtime activation without accepting physical paths or SQL selectors.
import { createHash, randomUUID } from "node:crypto";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { parseDeckRuntimePluginLock, type DeckRuntimePluginLock } from "./deckRuntimePluginLockDto";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { workflowLocalPlacementSchemaRequirement } from "./workflowRunCommandRepository";
import { projectWorkflowTimestamp } from "./workflowRunService";
import { workflowTimeDto } from "./workflowRunDto";
import { WorkflowRuntimeActivationRepository } from "./workflowRuntimeActivationRepository";
import * as dto from "./workflowRuntimeActivationDto";

export const workflowRuntimeActivationSchemaRequirements = [dreamUnifiedSchemaRequirement, workflowLocalPlacementSchemaRequirement] as const;
export type WorkflowRuntimeActivationActor = { principal: unknown; threadScope: string | null; runScope: string | null };

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function configuredWorkflowRuntimeActivationPolicy() {
  let raw: unknown;
  try { raw = JSON.parse(requiredAuthValue("DREAM_RUNTIME_ACTIVATION_POLICY_JSON")); }
  catch { throw new AuthBoundaryError("DREAM_RUNTIME_POLICY_NOT_CONFIGURED"); }
  const parsed = dto.workflowRuntimeActivationPolicyDto.safeParse(raw);
  if (!parsed.success || parsed.data.runtime_pool_id !== parsed.data.runtime_environment_id) {
    throw new AuthBoundaryError("DREAM_RUNTIME_POLICY_NOT_CONFIGURED");
  }
  return parsed.data;
}

function validateLock(lock: DeckRuntimePluginLock, policy: dto.WorkflowRuntimeActivationPolicy) {
  const ids = new Set(lock.claude_code_plugins.map(item => item.claude_code_plugin_id));
  const required = lock.claude_code_plugins.filter(item => item.required);
  if (ids.size !== lock.claude_code_plugins.length || required.length !== 1
    || required[0].claude_code_plugin_id !== policy.required_plugin_id
    || required[0].resolved_version !== policy.required_plugin_version) {
    throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
  }
  return required[0];
}

function validateObservedPlugins(lock: DeckRuntimePluginLock, observed: dto.WorkflowRuntimeActivationInput["verified_plugins"]) {
  const byId = new Map<string, (typeof observed)[number]>();
  for (const item of observed) {
    if (byId.has(item.package_spec)) throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
    byId.set(item.package_spec, item);
  }
  if (byId.size !== lock.claude_code_plugins.length) throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
  for (const locked of lock.claude_code_plugins) {
    const item = byId.get(locked.claude_code_plugin_id);
    if (!item || item.resolved_version !== locked.resolved_version
      || item.artifact_digest !== locked.artifact_digest || item.has_manifest !== true) {
      throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
    }
  }
}

function artifactSetHash(lock: DeckRuntimePluginLock) {
  const entries = lock.claude_code_plugins.filter(item => item.required)
    .map(item => ({ artifact_digest: item.artifact_digest, claude_code_plugin_id: item.claude_code_plugin_id, resolved_version: item.resolved_version }))
    .sort((a, b) => a.claude_code_plugin_id.localeCompare(b.claude_code_plugin_id));
  return sha256(canonicalJson(entries));
}

function materializationKey(policy: dto.WorkflowRuntimeActivationPolicy, required: DeckRuntimePluginLock["claude_code_plugins"][number], artifactHash: string) {
  return sha256(`${policy.runtime_environment_id}\0${policy.materialization_key_scope}\0${required.claude_code_plugin_id}\0${required.resolved_version}\0${required.artifact_digest}\0${artifactHash}`);
}

function sessionSettings(lock: DeckRuntimePluginLock, receiptId: string, workflowRunId: string) {
  const plugins = [...lock.claude_code_plugins].sort((a, b) => a.claude_code_plugin_id.localeCompare(b.claude_code_plugin_id));
  const capabilities = [...new Set(plugins.flatMap(item => item.capability_bindings))].sort();
  const marketplaces: Record<string, { source: string }> = {};
  for (const item of plugins) {
    const index = item.claude_code_plugin_id.lastIndexOf("@");
    const alias = index > 0 ? item.claude_code_plugin_id.slice(index + 1) : "";
    const source = item.source_ref;
    if (!alias || !source || source.length > 512 || ["secret", "token", "credential", "password"].some(marker => source.toLowerCase().includes(marker))
    ) throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
    marketplaces[alias] = { source };
  }
  const enabledPlugins = Object.fromEntries(plugins.map(item => [item.claude_code_plugin_id, true]));
  const settingsJson = canonicalJson({ enabledPlugins, extraKnownMarketplaces: marketplaces,
    pluginPolicy: { allowedCapabilities: capabilities } });
  const settingsHash = sha256(settingsJson);
  const pluginSetHash = sha256(canonicalJson(plugins.map(item => ({ artifact_digest: item.artifact_digest,
    capabilities: [...new Set(item.capability_bindings)].sort(), claude_code_plugin_id: item.claude_code_plugin_id,
    required: item.required, resolved_version: item.resolved_version }))));
  const sessionRequestKey = sha256(canonicalJson({ runtime_load_receipt_id: receiptId,
    settings_hash: settingsHash, workflow_run_id: workflowRunId }));
  return { settingsJson, settingsHash, pluginSetHash, sessionRequestKey, capabilities };
}

function outputFor(run: NonNullable<Awaited<ReturnType<WorkflowRuntimeActivationRepository["ownedRun"]>>>, replayed: boolean) {
  return dto.workflowRuntimeActivationOutputDto.parse({ thread_id: run.source_voice_thread_id,
    workflow_run_id: run.workflow_run_id, workspace_id: run.workspace_id,
    runtime_plugin_lock_id: run.runtime_plugin_lock_id, runtime_load_receipt_id: run.runtime_load_receipt_id,
    agent_session_id: run.agent_session_id, status: run.status, replayed });
}

export async function runWorkflowRuntimeActivationOperation(operation: dto.WorkflowRuntimeActivationOperation, rawInput: unknown,
  actor: WorkflowRuntimeActivationActor, serviceId: string, requestId: string, tx: DataTransaction,
  policy: dto.WorkflowRuntimeActivationPolicy = configuredWorkflowRuntimeActivationPolicy()) {
  const contract = dto.workflowRuntimeActivationOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data, principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if ((actor.threadScope !== null && actor.threadScope !== input.thread_id)
    || (actor.runScope !== null && actor.runScope !== input.workflow_run_id)) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  const store = new WorkflowRuntimeActivationRepository(tx);
  const run = await store.ownedRun(principal.canonical_user_id, input);
  if (!run || run.source_voice_thread_id !== input.thread_id || run.created_by !== principal.canonical_user_id) {
    throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  }
  const lockRow = await store.runtimeLock(run.runtime_plugin_lock_id);
  const parsedLock = parseDeckRuntimePluginLock(lockRow?.lock_json);
  if (!lockRow || !parsedLock.success || parsedLock.data.runtime_plugin_lock_id !== run.runtime_plugin_lock_id
    || parsedLock.data.deck_plugin_id !== run.deck_plugin_id
    || parsedLock.data.deck_plugin_version !== run.deck_plugin_version
    || parsedLock.data.deck_plugin_manifest_hash !== run.deck_plugin_manifest_hash) {
    throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
  }
  const lock = parsedLock.data, required = validateLock(lock, policy);
  validateObservedPlugins(lock, input.verified_plugins);
  const artifactHash = artifactSetHash(lock);

  return new ReceiptRepository(tx, serviceId, principal.subject).execute(operation, requestId, input, contract.output, async () => {
    const replayStatuses = new Set(["running", "output_validating", "pending_review", "confirmed"]);
    if (replayStatuses.has(run.status)) {
      if (!run.runtime_load_receipt_id || !run.agent_session_id) throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
      const materialized = await store.matchingMaterializations(policy, artifactHash);
      if (!validMaterializations(lock, materialized, policy, artifactHash)) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
      const session = await store.activeSession(run.agent_session_id);
      if (!session || session.status !== "active" || session.workflow_run_id !== run.workflow_run_id
        || session.runtime_load_receipt_id !== run.runtime_load_receipt_id
        || session.runtime_plugin_lock_id !== run.runtime_plugin_lock_id
        || session.remote_session_ref !== input.remote_session_ref) throw new AuthBoundaryError("DREAM_RUNTIME_INIT_INVALID", 409);
      return outputFor(run, true);
    }
    if (run.status !== "queued" || run.runtime_load_receipt_id !== null || run.agent_session_id !== null) {
      throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    }
    const installation = await store.readyInstallation(required.claude_code_plugin_id, required.resolved_version,
      required.artifact_digest, policy.required_source_type);
    if (!installation || installation.requested_package_spec !== required.claude_code_plugin_id
      || installation.resolved_version !== required.resolved_version || installation.artifact_digest !== required.artifact_digest
      || installation.source_type !== policy.required_source_type || installation.status !== "ready"
      || !installation.artifact_path) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    const now = workflowTimeDto.parse(projectWorkflowTimestamp(await store.clock()));
    const key = materializationKey(policy, required, artifactHash);
    const existing = await store.materializationByKey(key);
    if (existing) await store.refreshMaterialization(existing.id, required.artifact_digest, installation.artifact_path, now);
    else await store.insertMaterialization({ runtime_materialization_id: `rm_${randomUUID().replaceAll("-", "")}`,
      runtime_environment_id: policy.runtime_environment_id, runtime_pool_id: policy.runtime_pool_id,
      runtime_node_id: policy.runtime_node_id, claude_code_plugin_id: required.claude_code_plugin_id,
      resolved_version: required.resolved_version, artifact_digest: required.artifact_digest,
      materialized_digest: required.artifact_digest, artifact_set_hash: artifactHash, policy_revision: policy.policy_revision,
      declaration_status: "declared", materialization_status: "materialized", activation_status: "loadable",
      materialization_key: key, attempt_id: `rpa_${randomUUID().replaceAll("-", "")}`, attempt_count: 1,
      verification_status: "verified", retention_state: "shared_artifact", cache_ref: installation.artifact_path,
      created_at: now, updated_at: now });
    const materialized = await store.matchingMaterializations(policy, artifactHash);
    if (!validMaterializations(lock, materialized, policy, artifactHash)) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    const lockDigest = (await canonicalBusinessJson(lockRow.lock_json)).content_hash;
    const receiptId = `rlr_${randomUUID().replaceAll("-", "")}`;
    const receiptEntries = materialized.map(item => {
      const locked = lock.claude_code_plugins.find(entry => entry.claude_code_plugin_id === item.claude_code_plugin_id)!;
      return { receipt_id: receiptId, claude_code_plugin_id: locked.claude_code_plugin_id,
        resolved_version: locked.resolved_version, artifact_digest: locked.artifact_digest,
        materialized_digest: item.materialized_digest!, verification_status: item.verification_status!,
        signature_bundle_ref: item.signature_bundle_ref, retention_state: item.retention_state!,
        restore_source_ref: item.restore_source_ref, required: locked.required ? 1 : 0,
        loaded_capabilities_json: canonicalJson([...new Set(locked.capability_bindings)].sort()),
        load_status: "loaded", loaded_at: now };
    });
    const requiredReady = receiptEntries.some(item => item.required === 1)
      && receiptEntries.filter(item => item.required === 1).every(item => item.load_status === "loaded" && item.materialized_digest === item.artifact_digest);
    await store.insertReceipt({ receipt_id: receiptId, workflow_run_id: run.workflow_run_id,
      runtime_plugin_lock_id: run.runtime_plugin_lock_id, runtime_plugin_lock_digest: lockDigest,
      runtime_environment_id: policy.runtime_environment_id, runtime_pool_id: policy.runtime_pool_id,
      distribution_mode: policy.distribution_mode, runtime_node_id: policy.runtime_node_id,
      artifact_set_hash: artifactHash, policy_revision: policy.policy_revision, deployment_tier: policy.deployment_tier,
      scope: "session", readiness_state: "session_loaded", required_entries_ready: requiredReady ? 1 : 0,
      created_at: now }, receiptEntries);
    await store.markMaterializationsLoaded(materialized.map(item => item.runtime_materialization_id), now);
    const sessionId = `as_${randomUUID().replaceAll("-", "")}`;
    const settings = sessionSettings(lock, receiptId, run.workflow_run_id);
    const attempt = await store.nextAttempt(run.workflow_run_id);
    if (!Number.isSafeInteger(attempt) || attempt < 1) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    const ownerToken = randomUUID().replaceAll("-", "");
    await store.insertCreatingSession({ agent_session_id: sessionId, workflow_run_id: run.workflow_run_id,
      runtime_load_receipt_id: receiptId, runtime_environment_id: policy.runtime_environment_id,
      runtime_pool_id: policy.runtime_pool_id, distribution_mode: policy.distribution_mode,
      runtime_node_id: policy.runtime_node_id, artifact_set_hash: artifactHash, policy_revision: policy.policy_revision,
      deployment_tier: policy.deployment_tier, runtime_plugin_lock_id: run.runtime_plugin_lock_id,
      runtime_plugin_lock_digest: lockDigest, settings_json: settings.settingsJson, settings_hash: settings.settingsHash,
      plugin_set_hash: settings.pluginSetHash, session_request_key: settings.sessionRequestKey, attempt_number: attempt,
      status: "creating", error_code: null, termination_reason_code: null, created_at: now, started_at: null,
      terminated_at: null, owner_token: ownerToken, remote_session_ref: null }, policy.session_creating_lease_seconds);
    if (!await store.recordRemoteStart(sessionId, ownerToken, input.remote_session_ref)
      || !await store.activateSession(sessionId, ownerToken, now)) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    if (!await store.activateRun(run, receiptId, sessionId, now)) throw new AuthBoundaryError("DREAM_RUNTIME_NOT_READY", 409);
    await store.appendTransition(run.workflow_run_id, run.status_version + 1, principal.canonical_user_id, now);
    return outputFor({ ...run, status: "running", status_version: run.status_version + 1,
      runtime_load_receipt_id: receiptId, agent_session_id: sessionId, started_at: run.started_at ?? now }, false);
  }, run.source_voice_thread_id, null, run.workflow_run_id);
}

function validMaterializations(lock: DeckRuntimePluginLock,
  rows: Awaited<ReturnType<WorkflowRuntimeActivationRepository["matchingMaterializations"]>>,
  policy: dto.WorkflowRuntimeActivationPolicy, artifactHash: string) {
  const expected = new Map(lock.claude_code_plugins.map(item => [item.claude_code_plugin_id, item]));
  if (rows.length !== expected.size || new Set(rows.map(item => item.claude_code_plugin_id)).size !== expected.size) return false;
  return rows.every(item => {
    const locked = expected.get(item.claude_code_plugin_id);
    return Boolean(locked) && item.runtime_environment_id === policy.runtime_environment_id
      && item.runtime_pool_id === policy.runtime_pool_id && item.runtime_node_id === policy.runtime_node_id
      && item.artifact_set_hash === artifactHash && item.policy_revision === policy.policy_revision
      && item.resolved_version === locked!.resolved_version && item.artifact_digest === locked!.artifact_digest
      && item.materialized_digest === locked!.artifact_digest && item.declaration_status === "declared"
      && item.materialization_status === "materialized" && ["loadable", "loaded"].includes(item.activation_status)
      && item.verification_status !== null && item.retention_state !== null;
  });
}
