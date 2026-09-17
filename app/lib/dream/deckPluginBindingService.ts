// [Input] Strict Registry122-132 DTO, OAuth principal and caller-owned Admin transaction.
// [Output] Binding projections plus Agent-type/launch current-or-frozen Runtime preparation.
// [Pos] DTO-Service-typed ORM composition; Dream retains HTTP UI, local artifact verification and Runtime execution.
// [Sync] 2026-09-16: append launch scope, current/replay plan and evidence-bound preparation.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { pgTimestampToIso } from "./chatThreadDto";
import { DeckPluginBindingRepository, type DeckPluginBindingRow } from "./deckPluginBindingRepository";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { evaluateDeckPluginCompatibility, resolveDeckRuntimeContext, storedPluginStringSet } from "./deckPluginCompatibilityService";
import { parseDeckRuntimePluginLock } from "./deckRuntimePluginLockDto";
import { WorkflowRuntimeActivationRepository } from "./workflowRuntimeActivationRepository";
import {
  configuredWorkflowRuntimeActivationPolicy,
  runtimeArtifactSetHash,
  runtimeMaterializationKey,
  validateObservedRuntimePlugins,
  validateRuntimeLock,
} from "./workflowRuntimeActivationService";
import type { WorkflowRuntimeActivationPolicy } from "./workflowRuntimeActivationDto";
import * as dto from "./deckPluginBindingDto";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";

export const deckPluginBindingSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

const recovery = {
  DECK_PLUGIN_UNAVAILABLE: { owner: "deck_plugin_admin", action: "select_an_available_installed_release" },
  DECK_PLUGIN_DISABLED: { owner: "deck_plugin_admin", action: "enable_the_installation_or_select_another_release" },
  DECK_PLUGIN_UPGRADE_PENDING: { owner: "deck_plugin_admin", action: "approve_the_capability_expansion_or_keep_the_ready_version" },
  RUNTIME_CONTEXT_UNAVAILABLE: { owner: "runtime_platform", action: "restore_server_side_compatibility_and_readiness_signals" },
} as const;

function unavailable(releaseStatus: string, installationStatus: string, reason: keyof typeof recovery, compatibility: "failed" | "unknown" = "failed"): dto.DeckPluginSelectionSummary {
  return dto.deckPluginSelectionSummaryDto.parse({ selectable: false, release_status: releaseStatus, installation_status: installationStatus,
    compatibility, runtime_readiness: "unknown", reason_code: reason, recovery: recovery[reason], capability_summary: [] });
}

function compatibilityOwner(check: string | null) {
  if (check === "workflow_permission") return "workspace_admin";
  if (check === "runtime_plugin_ready") return "runtime_platform";
  return "deck_plugin_publisher";
}

async function selectionSummary(tx: DataTransaction, workspaceId: string, pluginId: string, pluginVersion: string): Promise<dto.DeckPluginSelectionSummary> {
  const store = new DeckPluginCompatibilityRepository(tx);
  const release = await store.release(pluginId, pluginVersion);
  if (!release) return unavailable("missing", "missing", "DECK_PLUGIN_UNAVAILABLE");
  if (!new Set(["published", "deprecated"]).has(release.status)) return unavailable(release.status, "unknown", "DECK_PLUGIN_UNAVAILABLE");
  const installation = await store.installation(pluginId, workspaceId, false);
  if (!installation) return unavailable(release.status, "missing", "DECK_PLUGIN_UNAVAILABLE");
  if (installation.status === "disabled") return unavailable(release.status, installation.status, "DECK_PLUGIN_DISABLED");
  if (installation.status === "upgrade_pending") return unavailable(release.status, installation.status, "DECK_PLUGIN_UPGRADE_PENDING");
  if (installation.status !== "ready" || !storedPluginStringSet(installation.installed_versions_json).has(pluginVersion)) {
    return unavailable(release.status, installation.status, "DECK_PLUGIN_UNAVAILABLE");
  }
  let facts: Awaited<ReturnType<typeof resolveDeckRuntimeContext>>;
  try { facts = await resolveDeckRuntimeContext(store, { workspace_id: workspaceId, deck_plugin_id: pluginId, deck_plugin_version: pluginVersion }); }
  catch { return unavailable(release.status, installation.status, "RUNTIME_CONTEXT_UNAVAILABLE", "unknown"); }
  const result = evaluateDeckPluginCompatibility(
    { workspace_id: workspaceId, deck_plugin_id: pluginId, deck_plugin_version: pluginVersion },
    facts.release,
    installation,
    facts.lockFacts,
    facts.context,
  );
  if (result.passed) return dto.deckPluginSelectionSummaryDto.parse({ selectable: true, release_status: release.status,
    installation_status: installation.status, compatibility: "passed", runtime_readiness: "materialized", reason_code: null,
    recovery: null, capability_summary: result.effective_capabilities });
  const late = result.failed_check === "workflow_permission" || result.failed_check === "runtime_plugin_ready";
  return dto.deckPluginSelectionSummaryDto.parse({ selectable: false, release_status: release.status,
    installation_status: installation.status, compatibility: late ? "passed" : "failed",
    runtime_readiness: result.failed_check === "runtime_plugin_ready" ? "not_ready" : "unknown",
    reason_code: result.error_code ?? "DECK_PLUGIN_UNAVAILABLE",
    recovery: { owner: compatibilityOwner(result.failed_check), action: result.recovery_action ?? "select_another_release" },
    capability_summary: [] });
}

function bindingResponse(row: DeckPluginBindingRow, validation: dto.DeckPluginSelectionSummary) {
  return dto.deckPluginBindingResponseDto.parse({
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    deck_id: row.deck_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    binding_revision: row.binding_revision,
    status: row.status,
    applied_to: row.applied_to,
    selection_validation_summary: validation,
  });
}

function bindingHistoryEntry(row: DeckPluginBindingRow) {
  return dto.deckPluginBindingHistoryEntryDto.parse({
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    binding_revision: row.binding_revision,
    status: row.status,
    applied_to: row.applied_to,
    created_at: pgTimestampToIso(row.created_at)!,
    updated_at: pgTimestampToIso(row.updated_at)!,
  });
}

const dreamAgentCapability = "story.workspace.propose";

async function runtimeTargetFromRows(store: DeckPluginBindingRepository, policy: WorkflowRuntimeActivationPolicy,
  rows: Awaited<ReturnType<DeckPluginBindingRepository["runtimeTargets"]>>) {
  const matches = [];
  for (const row of rows) {
    const parsed = parseDeckRuntimePluginLock(row.lock_json);
    if (!parsed.success) continue;
    const lock = parsed.data;
    const required = lock.claude_code_plugins.filter(item => item.required);
    if (required.length !== 1 || required[0].claude_code_plugin_id !== policy.required_plugin_id
      || required[0].resolved_version !== policy.required_plugin_version) continue;
    if (row.manifest_hash !== row.deck_plugin_manifest_hash || lock.runtime_plugin_lock_id !== row.runtime_plugin_lock_id
      || lock.deck_plugin_id !== row.deck_plugin_id || lock.deck_plugin_version !== row.deck_plugin_version
      || lock.deck_plugin_manifest_hash !== row.manifest_hash || !lock.production_ready
      || !storedPluginStringSet(row.capabilities_json).has(dreamAgentCapability)) {
      throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_INVALID", 503);
    }
    const checkedRequired = validateRuntimeLock(lock, policy);
    const installation = await store.readyRuntimeInstallation(
      checkedRequired.claude_code_plugin_id,
      checkedRequired.resolved_version,
      checkedRequired.artifact_digest,
      policy.required_source_type,
    );
    if (!installation || !installation.artifact_path || !installation.manifest_json) {
      throw new AuthBoundaryError("RUNTIME_PLUGIN_NOT_READY", 503);
    }
    matches.push({ row, lock, required: checkedRequired, installation,
      capabilities: [...storedPluginStringSet(row.capabilities_json)].sort() });
  }
  if (matches.length !== 1) throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_INVALID", 503);
  return matches[0];
}

async function runtimeTarget(store: DeckPluginBindingRepository, policy: WorkflowRuntimeActivationPolicy) {
  return runtimeTargetFromRows(store, policy, await store.runtimeTargets());
}

function launchBinding(row: { deck_plugin_binding_id: string; deck_plugin_id: string;
  deck_plugin_version: string; binding_revision: number }) {
  return dto.dreamLaunchRuntimeBindingDto.parse({
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    binding_revision: row.binding_revision,
  });
}

async function launchRuntimePlan(store: DeckPluginBindingRepository, input: dto.DreamLaunchRuntimePlanInput,
  actorId: string, policy: WorkflowRuntimeActivationPolicy, lock: "share" | "update") {
  if (input.mode === "current") {
    const binding = await store.current(input.deck_id, lock);
    if (!binding || binding.workspace_id !== input.workspace_id || binding.creator_id !== actorId) {
      throw new AuthBoundaryError("WORKFLOW_SELECTION_REQUIRED", 409);
    }
    const target = await runtimeTarget(store, policy);
    if (binding.deck_plugin_id !== target.row.deck_plugin_id
      || binding.deck_plugin_version !== target.row.deck_plugin_version) {
      throw new AuthBoundaryError("WORKFLOW_SELECTION_REQUIRED", 409);
    }
    return { binding: launchBinding(binding), target };
  }
  const run = await store.replayBinding(
    input.workflow_run_id!, input.thread_id!, input.deck_id, input.workspace_id, lock,
  );
  if (!run) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  if (run.binding_deck_id !== input.deck_id || run.binding_workspace_id !== input.workspace_id
    || run.binding_creator_id !== actorId || run.binding_plugin_id !== run.deck_plugin_id
    || run.binding_plugin_version !== run.deck_plugin_version
    || run.binding_revision_actual !== run.binding_revision) {
    throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_INVALID", 409);
  }
  const targetRow = await store.runtimeTargetByLock(run.runtime_plugin_lock_id);
  const target = await runtimeTargetFromRows(store, policy, targetRow ? [targetRow] : []);
  if (target.row.deck_plugin_id !== run.deck_plugin_id
    || target.row.deck_plugin_version !== run.deck_plugin_version
    || target.row.manifest_hash !== run.deck_plugin_manifest_hash) {
    throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_INVALID", 409);
  }
  return { binding: launchBinding({
    deck_plugin_binding_id: run.deck_plugin_binding_id,
    deck_plugin_id: run.deck_plugin_id,
    deck_plugin_version: run.deck_plugin_version,
    binding_revision: run.binding_revision,
  }), target };
}

function runtimePlanOutput(deckId: string, revision: number, target: Awaited<ReturnType<typeof runtimeTarget>>) {
  const { row, installation } = target;
  return dto.deckAgentTypeRuntimePlanDto.parse({
    deck_id: deckId,
    current_binding_revision: revision,
    target: {
      deck_plugin_id: row.deck_plugin_id,
      deck_plugin_version: row.deck_plugin_version,
      runtime_plugin_lock_id: row.runtime_plugin_lock_id,
      plugin_installation_id: installation.plugin_installation_id,
      package_spec: installation.package_spec,
      package_name: installation.package_name,
      marketplace: installation.marketplace,
      resolved_version: installation.resolved_version,
      artifact_digest: installation.artifact_digest,
      compatibility_json: installation.compatibility_json,
    },
  });
}

export async function runDeckPluginBindingOperation(
  operation: dto.DeckPluginBindingOperation,
  rawInput: unknown,
  rawPrincipal: unknown,
  tx: DataTransaction,
  suppliedRuntimePolicy?: WorkflowRuntimeActivationPolicy,
) {
  const contract = dto.deckPluginBindingOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data as dto.DeckPluginBindingScopeInput;
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new DeckPluginBindingRepository(tx, principal.canonical_user_id);
  const mutating = contract.kind === "write";
  const launchOperation = operation.startsWith("dream-launch.runtime-");
  const owned = launchOperation
    ? await store.ownsEnabledDeckWorkspace(input.deck_id, input.workspace_id, mutating ? "update" : "share")
    : await store.ownsDeckWorkspace(input.deck_id, input.workspace_id, mutating ? "update" : "share");
  if (!owned) {
    throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);
  }
  if (launchOperation) {
    const scoped = parsed.data as dto.DreamLaunchRuntimePlanInput;
    if (scoped.agent_id !== null && !await store.enabledAgent(scoped.deck_id, scoped.agent_id)) {
      throw new AuthBoundaryError("AGENT_ACCESS_DENIED", 404);
    }
  }

  let result: unknown;
  switch (operation) {
    case "deck-plugin-binding.current": {
      const row = await store.current(input.deck_id);
      result = { deck_id: input.deck_id, binding_revision: row?.binding_revision ?? await store.latestRevision(input.deck_id), applied_to: "next_run",
        binding: row ? bindingResponse(row, await selectionSummary(tx, input.workspace_id, row.deck_plugin_id, row.deck_plugin_version)) : null };
      break;
    }
    case "deck-plugin-binding.history": {
      const historyInput = dto.deckPluginBindingHistoryInputDto.parse(parsed.data);
      result = { deck_id: input.deck_id, current_binding_revision: await store.latestRevision(input.deck_id),
        entries: (await store.history(input.deck_id, historyInput.limit)).map(bindingHistoryEntry) };
      break;
    }
    case "deck-plugin-binding.options": {
      const options = [];
      for (const row of await store.selectableReleases()) {
        const summary = await selectionSummary(tx, input.workspace_id, row.deck_plugin_id, row.deck_plugin_version);
        options.push({ display_name: row.display_name, deck_plugin_id: row.deck_plugin_id, deck_plugin_version: row.deck_plugin_version,
          release_status: summary.release_status, installation_status: summary.installation_status, compatibility: summary.compatibility,
          runtime_readiness: summary.runtime_readiness, selectable: summary.selectable, reason_code: summary.reason_code,
          recovery: summary.recovery, capability_summary: summary.capability_summary });
      }
      result = { deck_id: input.deck_id, applied_to: "next_run", options };
      break;
    }
    case "deck-plugin-binding.validate": {
      const selection = dto.deckPluginBindingSelectionInputDto.parse(parsed.data);
      result = { deck_id: selection.deck_id, deck_plugin_id: selection.deck_plugin_id, deck_plugin_version: selection.deck_plugin_version,
        applied_to: "next_run", validation: await selectionSummary(tx, selection.workspace_id, selection.deck_plugin_id, selection.deck_plugin_version) };
      break;
    }
    case "deck-plugin-binding.save": {
      const save = dto.deckPluginBindingSaveInputDto.parse(parsed.data);
      const current = await store.current(save.deck_id, "update");
      const latest = await store.latestRevision(save.deck_id);
      if (save.expected_binding_revision !== latest) throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: latest });
      const validation = await selectionSummary(tx, save.workspace_id, save.deck_plugin_id, save.deck_plugin_version);
      if (!validation.selectable) throw new AuthBoundaryError("SELECTION_NOT_ALLOWED", 422, { validation });
      if (current && current.deck_plugin_id === save.deck_plugin_id && current.deck_plugin_version === save.deck_plugin_version) {
        result = bindingResponse(current, validation);
        break;
      }
      if (current && !await store.markCurrentStale(current.deck_plugin_binding_id, current.binding_revision)) {
        throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: await store.latestRevision(save.deck_id) });
      }
      const created = await store.insert({ ...save, binding_revision: latest + 1 });
      await store.advanceDraftRevision(save.deck_id);
      result = bindingResponse(created, validation);
      break;
    }
    case "deck-plugin-binding.clear": {
      const clear = dto.deckPluginBindingClearInputDto.parse(parsed.data);
      const current = await store.current(clear.deck_id, "update");
      const latest = await store.latestRevision(clear.deck_id);
      if (clear.expected_binding_revision !== latest) {
        throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: latest });
      }
      if (current) {
        if (!await store.markCurrentStale(current.deck_plugin_binding_id, current.binding_revision)) {
          throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: await store.latestRevision(clear.deck_id) });
        }
        await store.advanceDraftRevision(clear.deck_id);
      }
      result = { deck_id: clear.deck_id, agent_type: "chat", binding_revision: latest };
      break;
    }
    case "deck-agent-type.runtime-plan": {
      const policy = suppliedRuntimePolicy ?? configuredWorkflowRuntimeActivationPolicy();
      const target = await runtimeTarget(store, policy);
      result = runtimePlanOutput(input.deck_id, await store.latestRevision(input.deck_id), target);
      break;
    }
    case "deck-agent-type.runtime-prepare": {
      const prepare = dto.deckAgentTypeRuntimePrepareInputDto.parse(parsed.data);
      const latest = await store.latestRevision(prepare.deck_id);
      if (prepare.expected_binding_revision !== latest) {
        throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409, { current_revision: latest });
      }
      const policy = suppliedRuntimePolicy ?? configuredWorkflowRuntimeActivationPolicy();
      const target = await runtimeTarget(store, policy);
      const expected = target.installation;
      if (prepare.verified_plugin.plugin_installation_id !== expected.plugin_installation_id
        || prepare.verified_plugin.package_spec !== expected.package_spec
        || prepare.verified_plugin.resolved_version !== expected.resolved_version
        || prepare.verified_plugin.artifact_digest !== expected.artifact_digest) {
        throw new AuthBoundaryError("RUNTIME_PLUGIN_NOT_READY", 409);
      }
      validateObservedRuntimePlugins(target.lock, [prepare.verified_plugin]);
      const runtimeStore = new WorkflowRuntimeActivationRepository(tx);
      const artifactHash = runtimeArtifactSetHash(target.lock);
      const key = runtimeMaterializationKey(policy, target.required, artifactHash);
      const nowValue = await runtimeStore.clock();
      const now = new Date(nowValue).toISOString();
      const existing = await runtimeStore.materializationByKey(key);
      if (existing) {
        await runtimeStore.refreshMaterialization(existing.id, target.required.artifact_digest, expected.artifact_path, now);
      } else {
        await runtimeStore.insertMaterialization({
          runtime_materialization_id: `rm_${randomUUID().replaceAll("-", "")}`,
          runtime_environment_id: policy.runtime_environment_id,
          runtime_pool_id: policy.runtime_pool_id,
          runtime_node_id: policy.runtime_node_id,
          claude_code_plugin_id: target.required.claude_code_plugin_id,
          resolved_version: target.required.resolved_version,
          artifact_digest: target.required.artifact_digest,
          materialized_digest: target.required.artifact_digest,
          artifact_set_hash: artifactHash,
          policy_revision: policy.policy_revision,
          declaration_status: "declared",
          materialization_status: "materialized",
          activation_status: "loadable",
          materialization_key: key,
          attempt_id: `rpa_${randomUUID().replaceAll("-", "")}`,
          attempt_count: 1,
          verification_status: "verified",
          retention_state: "shared_artifact",
          cache_ref: expected.artifact_path,
          created_at: now,
          updated_at: now,
        });
      }
      let workspaceInstallation = await store.workspaceInstallation(prepare.workspace_id, target.row.deck_plugin_id);
      if (!workspaceInstallation) {
        workspaceInstallation = await store.insertReadyWorkspaceInstallation(
          prepare.workspace_id, target.row.deck_plugin_id, target.row.deck_plugin_version, target.capabilities,
        );
      }
      if (!workspaceInstallation || workspaceInstallation.status !== "ready"
        || workspaceInstallation.default_version !== target.row.deck_plugin_version
        || !storedPluginStringSet(workspaceInstallation.installed_versions_json).has(target.row.deck_plugin_version)
        || [...storedPluginStringSet(workspaceInstallation.approved_capabilities_json)].sort().join("\0") !== target.capabilities.join("\0")) {
        throw new AuthBoundaryError("DECK_PLUGIN_UNAVAILABLE", 409);
      }
      result = {
        deck_id: prepare.deck_id,
        deck_plugin_id: target.row.deck_plugin_id,
        deck_plugin_version: target.row.deck_plugin_version,
        current_binding_revision: latest,
        runtime_ready: true,
      };
      break;
    }
    case "dream-launch.runtime-scope": {
      const scope = dto.dreamLaunchRuntimeScopeInputDto.parse(parsed.data);
      result = { ...scope, authorized: true };
      break;
    }
    case "dream-launch.runtime-plan": {
      const plan = dto.dreamLaunchRuntimePlanInputDto.parse(parsed.data);
      const policy = suppliedRuntimePolicy ?? configuredWorkflowRuntimeActivationPolicy();
      const resolved = await launchRuntimePlan(store, plan, principal.canonical_user_id, policy, "share");
      result = { ...plan, binding: resolved.binding,
        target: runtimePlanOutput(plan.deck_id, resolved.binding.binding_revision, resolved.target).target };
      break;
    }
    case "dream-launch.runtime-prepare": {
      const prepare = dto.dreamLaunchRuntimePrepareInputDto.parse(parsed.data);
      const policy = suppliedRuntimePolicy ?? configuredWorkflowRuntimeActivationPolicy();
      const resolved = await launchRuntimePlan(store, prepare, principal.canonical_user_id, policy, "update");
      if (prepare.expected_binding_revision !== resolved.binding.binding_revision) {
        throw new AuthBoundaryError("BINDING_REVISION_CONFLICT", 409,
          { current_revision: resolved.binding.binding_revision });
      }
      const expected = resolved.target.installation;
      if (prepare.verified_plugin.plugin_installation_id !== expected.plugin_installation_id
        || prepare.verified_plugin.package_spec !== expected.package_spec
        || prepare.verified_plugin.resolved_version !== expected.resolved_version
        || prepare.verified_plugin.artifact_digest !== expected.artifact_digest) {
        throw new AuthBoundaryError("RUNTIME_PLUGIN_NOT_READY", 409);
      }
      validateObservedRuntimePlugins(resolved.target.lock, [prepare.verified_plugin]);
      const runtimeStore = new WorkflowRuntimeActivationRepository(tx);
      const artifactHash = runtimeArtifactSetHash(resolved.target.lock);
      const key = runtimeMaterializationKey(policy, resolved.target.required, artifactHash);
      const now = new Date(await runtimeStore.clock()).toISOString();
      const existing = await runtimeStore.materializationByKey(key);
      if (existing) {
        await runtimeStore.refreshMaterialization(existing.id, resolved.target.required.artifact_digest,
          expected.artifact_path, now);
      } else {
        await runtimeStore.insertMaterialization({
          runtime_materialization_id: `rm_${randomUUID().replaceAll("-", "")}`,
          runtime_environment_id: policy.runtime_environment_id,
          runtime_pool_id: policy.runtime_pool_id,
          runtime_node_id: policy.runtime_node_id,
          claude_code_plugin_id: resolved.target.required.claude_code_plugin_id,
          resolved_version: resolved.target.required.resolved_version,
          artifact_digest: resolved.target.required.artifact_digest,
          materialized_digest: resolved.target.required.artifact_digest,
          artifact_set_hash: artifactHash,
          policy_revision: policy.policy_revision,
          declaration_status: "declared",
          materialization_status: "materialized",
          activation_status: "loadable",
          materialization_key: key,
          attempt_id: `rpa_${randomUUID().replaceAll("-", "")}`,
          attempt_count: 1,
          verification_status: "verified",
          retention_state: "shared_artifact",
          cache_ref: expected.artifact_path,
          created_at: now,
          updated_at: now,
        });
      }
      if (prepare.mode === "current") {
        let installation = await store.workspaceInstallation(prepare.workspace_id, resolved.target.row.deck_plugin_id);
        if (!installation) installation = await store.insertReadyWorkspaceInstallation(
          prepare.workspace_id, resolved.target.row.deck_plugin_id, resolved.target.row.deck_plugin_version,
          resolved.target.capabilities, "system:dream-launch/v2",
        );
        if (!installation || installation.status !== "ready"
          || installation.default_version !== resolved.target.row.deck_plugin_version
          || !storedPluginStringSet(installation.installed_versions_json).has(resolved.target.row.deck_plugin_version)) {
          throw new AuthBoundaryError("DECK_PLUGIN_UNAVAILABLE", 409);
        }
      }
      result = {
        deck_id: prepare.deck_id,
        workspace_id: prepare.workspace_id,
        agent_id: prepare.agent_id,
        mode: prepare.mode,
        workflow_run_id: prepare.workflow_run_id,
        thread_id: prepare.thread_id,
        binding: resolved.binding,
        runtime_ready: true,
      };
      break;
    }
  }
  return contract.output.parse(result);
}
