// [Input] Registered Deck Plugin control operation, OAuth principal and caller-owned Admin data transaction.
// [Output] Owner/role checked views, immutable local-verification plans and atomic lifecycle/materialization changes.
// [Pos] Registry170-174 domain authority; Dream keeps filesystem verification while Admin owns state, transactions and permissions.
// [Sync] 2026-09-16: preserve the active Dream installation state machine behind DTO-Service-Drizzle.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { canonicalContractJson } from "./canonicalContractJson";
import { pgTimestampToIso } from "./chatThreadDto";
import { comparePythonStrings } from "./deckPluginCompatibilityDto";
import { parseDeckPluginManifest, type DeckPluginManifestDto } from "./deckPluginManifestDto";
import { parseDeckRuntimePluginLock, type DeckRuntimePluginLock } from "./deckRuntimePluginLockDto";
import { configuredWorkflowRuntimeActivationPolicy, runtimeArtifactSetHash, runtimeMaterializationKey } from "./workflowRuntimeActivationService";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { workflowLocalPlacementSchemaRequirement } from "./workflowRunCommandRepository";
import { DeckPluginControlRepository, type DeckPluginControlInstallationRow, type DeckPluginControlReleaseRow } from "./deckPluginControlRepository";
import * as dto from "./deckPluginControlDto";

export const deckPluginControlSchemaRequirements = [dreamUnifiedSchemaRequirement, workflowLocalPlacementSchemaRequirement] as const;

type Principal = ReturnType<typeof principalDto.parse>;
type LockEntry = DeckRuntimePluginLock["claude_code_plugins"][number];
type ReleaseSnapshot = { row: DeckPluginControlReleaseRow; manifest: DeckPluginManifestDto;
  runtimeLock: DeckRuntimePluginLock; target: dto.DeckPluginControlRuntimeTarget };

const activeStatuses = new Set(["installing", "ready", "disabled", "error", "upgrade_pending"]);
const transitions: Record<string, Set<string>> = {
  installing: new Set(["ready", "error", "uninstalled"]),
  ready: new Set(["disabled", "upgrade_pending", "uninstalled"]),
  disabled: new Set(["ready", "uninstalled"]),
  error: new Set(["installing", "uninstalled"]),
  upgrade_pending: new Set(["installing", "uninstalled"]),
  uninstalled: new Set(),
};

function fail(code: string, status = 409): never {
  throw new AuthBoundaryError(code, status);
}

function storedStrings(raw: string | null, code = "DECK_PLUGIN_CONTROL_DATA_INVALID") {
  let value: unknown;
  try { value = JSON.parse(raw ?? "[]"); } catch { fail(code, 503); }
  if (!Array.isArray(value) || value.some(item => typeof item !== "string") || new Set(value).size !== value.length) fail(code, 503);
  return value as string[];
}

function semverKey(value: string): [number, number, number, string] {
  const [withoutBuild] = value.split("+", 1), [core, suffix = ""] = withoutBuild.split("-", 2);
  const parts = core.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, suffix];
}

function compareSemver(left: string, right: string) {
  const a = semverKey(left), b = semverKey(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return Number(a[index]) - Number(b[index]);
  return String(a[3]).localeCompare(String(b[3]));
}

function capabilityDiff(current: string[], target: string[]) {
  const present = new Set(current), next = new Set(target);
  return dto.deckPluginControlCapabilityDiffDto.parse({
    added: [...next].filter(item => !present.has(item)).sort(comparePythonStrings),
    removed: [...present].filter(item => !next.has(item)).sort(comparePythonStrings),
  });
}

async function authorize(store: DeckPluginControlRepository, principal: Principal, scopeType: "instance" | "workspace",
  scopeId: string, lock: "share" | "update") {
  if (scopeType === "workspace") {
    if (!await store.ownedWorkspace(scopeId, lock)) fail("WORKFLOW_PERMISSION_DENIED", 403);
    return;
  }
  const actor = await store.actorRole();
  if (!actor || actor.role !== "admin") fail("WORKFLOW_PERMISSION_DENIED", 403);
  if (principal.status !== "active") fail("DREAM_PRINCIPAL_DISABLED", 403);
}

function runtimeTarget(lock: DeckRuntimePluginLock) {
  const target = {
    runtime_plugin_lock_id: lock.runtime_plugin_lock_id,
    deck_plugin_manifest_hash: lock.deck_plugin_manifest_hash,
    artifact_set_hash: runtimeArtifactSetHash(lock),
    entries: lock.claude_code_plugins.map(item => ({ claude_code_plugin_id: item.claude_code_plugin_id,
      resolved_version: item.resolved_version, source_ref: item.source_ref, artifact_digest: item.artifact_digest,
      required: item.required })),
  };
  const parsed = dto.deckPluginControlRuntimeTargetDto.safeParse(target);
  if (!parsed.success) fail("DECK_PLUGIN_RUNTIME_NOT_READY", 409);
  return parsed.data;
}

function snapshot(row: DeckPluginControlReleaseRow): ReleaseSnapshot {
  const manifest = parseDeckPluginManifest(row.manifest_json), lock = parseDeckRuntimePluginLock(row.lock_json);
  if (!manifest.success || !lock.success || row.manifest_hash !== row.deck_plugin_manifest_hash
    || manifest.data.deck_plugin_id !== row.deck_plugin_id || manifest.data.deck_plugin_version !== row.deck_plugin_version
    || lock.data.runtime_plugin_lock_id !== row.runtime_plugin_lock_id || lock.data.deck_plugin_id !== row.deck_plugin_id
    || lock.data.deck_plugin_version !== row.deck_plugin_version || lock.data.deck_plugin_manifest_hash !== row.manifest_hash) {
    fail("DECK_PLUGIN_RELEASE_UNAVAILABLE", 409);
  }
  return { row, manifest: manifest.data, runtimeLock: lock.data, target: runtimeTarget(lock.data) } as ReleaseSnapshot;
}

async function requiredRelease(store: DeckPluginControlRepository, pluginId: string, version: string) {
  const row = await store.release(pluginId, version);
  if (!row) fail("DECK_PLUGIN_UNAVAILABLE", 404);
  return snapshot(row);
}

async function runtimeRows(store: DeckPluginControlRepository, lock: DeckRuntimePluginLock) {
  const result = [];
  for (const entry of lock.claude_code_plugins) {
    const row = await store.latestMaterialization(entry.claude_code_plugin_id, entry.resolved_version, entry.artifact_digest);
    const healthy = row?.materialization_status === "materialized" && ["loadable", "loaded"].includes(row.activation_status);
    result.push(dto.deckPluginRuntimeViewDto.parse({
      claude_code_plugin_id: entry.claude_code_plugin_id,
      resolved_version: entry.resolved_version,
      version_constraint: entry.resolved_version,
      artifact_digest: entry.artifact_digest,
      declaration_status: row?.declaration_status ?? "undeclared",
      materialization_status: row?.materialization_status ?? "missing",
      activation_status: row?.activation_status ?? "inactive",
      health_status: healthy ? "healthy" : row?.materialization_status === "failed" ? "failed" : "unknown",
      last_error_code: row?.last_error ? "RUNTIME_PLUGIN_NOT_READY" : null,
      last_error_summary: row?.last_error ?? null,
      updated_at: row ? pgTimestampToIso(row.updated_at) : null,
    }));
  }
  return result;
}

async function view(store: DeckPluginControlRepository, release: ReleaseSnapshot,
  installation: DeckPluginControlInstallationRow | null) {
  const runtime = await runtimeRows(store, release.runtimeLock);
  const installed = installation ? storedStrings(installation.installed_versions_json) : [];
  const approved = installation ? storedStrings(installation.approved_capabilities_json) : [];
  const defaultVersion = installation?.default_version ?? null;
  const status = installation?.status ?? "uninstalled";
  const allMaterialized = runtime.length > 0 && runtime.every(item => item.materialization_status === "materialized");
  const allLoadable = runtime.length > 0 && runtime.every(item => ["loadable", "loaded"].includes(item.activation_status));
  const versions = (await store.availableVersions(release.row.deck_plugin_id)).map(item => item.version);
  const newer = versions.filter(item => compareSemver(item, defaultVersion ?? "0.0.0") > 0);
  const effective = approved.filter(item => release.manifest.capabilities.includes(item)).sort(comparePythonStrings);
  return dto.deckPluginControlViewDto.parse({
    deck_plugin_installation_id: installation?.id ?? `preview:${release.row.id}`,
    deck_plugin_id: release.row.deck_plugin_id,
    display_name: release.manifest.display_name,
    deck_plugin_version: defaultVersion ?? release.row.deck_plugin_version,
    installed_versions: installed,
    default_version: defaultVersion,
    available_version: newer.sort(compareSemver).at(-1) ?? null,
    status,
    source: { type: "controlled", label: (installation?.source_policy_id ?? "server-published").split(":", 1)[0], verified: true },
    approved_capabilities: approved,
    capabilities: { manifest_requested: release.manifest.capabilities, effective },
    compatibility: { passed: ["ready", "disabled"].includes(status) && allLoadable,
      status: ["ready", "disabled"].includes(status) && allLoadable ? "compatible" : "pending", effective_capabilities: effective },
    runtime_readiness: { declaration_status: status === "disabled" ? "disabled" : installation && status !== "uninstalled" ? "declared" : "undeclared",
      materialization_status: allMaterialized ? "materialized" : "missing", activation_status: allLoadable ? "loadable" : "inactive" },
    health_status: status === "ready" && allLoadable ? "healthy" : "unknown",
    last_error_code: installation?.last_error_code ?? null,
    last_error_summary: installation?.last_error_summary ?? null,
    updated_at: pgTimestampToIso(installation?.updated_at ?? release.row.updated_at),
    rollback_versions: installed.filter(item => item !== defaultVersion),
    manifest: { schema_version: release.manifest.schema_version, author: release.manifest.author,
      workflow_references: [release.manifest.workflow.workflow_definition_ref],
      input_schema_version: release.manifest.workflow.input_schema_ref,
      output_schema_version: release.manifest.workflow.output_schema_ref,
      deck_runtime_contract: release.manifest.runtime_configuration.profile_contract,
      capabilities: release.manifest.capabilities },
    runtime_plugins: runtime, history: [], recent_runs: [], operation_logs: [],
    is_system: release.manifest.deck_plugin_id.startsWith("ink."),
  });
}

function requireTransition(current: string, target: string) {
  if (!transitions[current]?.has(target)) fail("DECK_PLUGIN_INVALID_TRANSITION", 409);
}

async function buildPlan(store: DeckPluginControlRepository, principal: Principal, command: dto.DeckPluginControlCommand,
  lock: "share" | "update") {
  if (lock === "update") await store.serialize(command.scope_type, command.scope_id, command.deck_plugin_id);
  await authorize(store, principal, command.scope_type, command.scope_id, lock);
  const row = await store.installation(command.scope_type, command.scope_id, command.deck_plugin_id, lock);
  let targetVersion: string | null = null, sourcePolicy: string | null = null;
  let release: ReleaseSnapshot | null = null, requiresEvidence = false;
  let diff = dto.deckPluginControlCapabilityDiffDto.parse({ added: [], removed: [] });

  if (command.action === "install") {
    release = await requiredRelease(store, command.deck_plugin_id, command.deck_plugin_version);
    if (command.source_type === "local" || !release.runtimeLock.claude_code_plugins.some(item => item.source_ref === command.source)) {
      fail("DECK_PLUGIN_SOURCE_DENIED", 403);
    }
    targetVersion = command.deck_plugin_version;
    sourcePolicy = `${command.source_type}:${command.source}`;
    if (row && activeStatuses.has(row.status) && row.default_version === targetVersion) requiresEvidence = false;
    else {
      if (row) fail("DECK_PLUGIN_INSTALLATION_CONFLICT", 409);
      diff = capabilityDiff([], release.manifest.capabilities);
      requiresEvidence = true;
    }
  } else {
    if (!row || !activeStatuses.has(row.status)) fail("DECK_PLUGIN_UNAVAILABLE", 404);
    const approved = storedStrings(row.approved_capabilities_json);
    switch (command.action) {
      case "enable": requireTransition(row.status, "ready"); targetVersion = row.default_version; break;
      case "disable": requireTransition(row.status, "disabled"); targetVersion = row.default_version; break;
      case "upgrade": {
        if (row.status !== "ready") fail("DECK_PLUGIN_INVALID_TRANSITION", 409);
        if (command.target_version === row.default_version) fail("DECK_PLUGIN_INSTALLATION_CONFLICT", 409);
        release = await requiredRelease(store, command.deck_plugin_id, command.target_version);
        targetVersion = command.target_version; diff = capabilityDiff(approved, release.manifest.capabilities);
        requiresEvidence = diff.added.length === 0; break;
      }
      case "approve_upgrade": {
        if (row.status !== "upgrade_pending" || !row.pending_version) fail("DECK_PLUGIN_INVALID_TRANSITION", 409);
        release = await requiredRelease(store, command.deck_plugin_id, row.pending_version);
        const pending = storedStrings(row.pending_capabilities_json);
        if (canonicalContractJson(pending) !== canonicalContractJson(release.manifest.capabilities)) fail("DECK_PLUGIN_CONTROL_DATA_INVALID", 503);
        targetVersion = row.pending_version; diff = capabilityDiff(approved, pending); requiresEvidence = true; break;
      }
      case "reject_upgrade":
        if (row.status !== "upgrade_pending") fail("DECK_RUNTIME_CONFIG_INVALID", 409);
        targetVersion = row.default_version; break;
      case "rollback": {
        if (row.status !== "ready") fail("DECK_PLUGIN_INVALID_TRANSITION", 409);
        if (!storedStrings(row.installed_versions_json).includes(command.target_version)) fail("DECK_PLUGIN_ROLLBACK_BLOCKED", 409);
        release = await requiredRelease(store, command.deck_plugin_id, command.target_version);
        targetVersion = command.target_version; requiresEvidence = true; break;
      }
      case "uninstall":
        requireTransition(row.status, "uninstalled");
        if (command.purge) fail("DECK_PLUGIN_PURGE_RETENTION_BLOCKED", 409);
        targetVersion = row.default_version; break;
      case "reconcile": {
        targetVersion = row.default_version ?? row.pending_version;
        if (!targetVersion) fail("DECK_PLUGIN_RUNTIME_NOT_READY", 409);
        release = await requiredRelease(store, command.deck_plugin_id, targetVersion); requiresEvidence = true; break;
      }
    }
  }
  return dto.deckPluginControlPlanDto.parse({ command, expected_revision: row?.revision ?? null,
    deck_plugin_installation_id: row?.id ?? null, target_version: targetVersion, source_policy_id: sourcePolicy,
    capability_diff: diff, requires_runtime_evidence: requiresEvidence, runtime_target: requiresEvidence ? release?.target ?? null : null });
}

function validateEvidence(plan: dto.DeckPluginControlPlan, evidence: dto.DeckPluginControlEvidence[]) {
  if (!plan.requires_runtime_evidence) {
    if (evidence.length !== 0) fail("DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID", 400);
    return;
  }
  const target = plan.runtime_target!;
  if (evidence.length !== target.entries.length) fail("DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID", 409);
  const byId = new Map(evidence.map(item => [item.claude_code_plugin_id, item]));
  if (byId.size !== evidence.length) fail("DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID", 409);
  for (const expected of target.entries) {
    const actual = byId.get(expected.claude_code_plugin_id);
    if (!actual || actual.resolved_version !== expected.resolved_version || actual.artifact_digest !== expected.artifact_digest
      || actual.materialized_digest !== expected.artifact_digest || actual.has_manifest !== true) {
      fail("DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID", 409);
    }
  }
}

async function persistEvidence(store: DeckPluginControlRepository, plan: dto.DeckPluginControlPlan,
  evidence: dto.DeckPluginControlEvidence[]) {
  if (!plan.requires_runtime_evidence) return;
  const policy = configuredWorkflowRuntimeActivationPolicy(), now = pgTimestampToIso(await store.clock());
  if (!now) fail("DECK_PLUGIN_RUNTIME_NOT_READY", 503);
  const target = plan.runtime_target!;
  for (const expected of target.entries) {
    const actual = evidence.find(item => item.claude_code_plugin_id === expected.claude_code_plugin_id)!;
    const lockEntry: LockEntry = { ...expected, capability_bindings: [] };
    const key = runtimeMaterializationKey(policy, lockEntry, target.artifact_set_hash);
    const existing = await store.materializationByKey(key);
    if (existing) await store.refreshMaterialization(existing.id, actual.materialized_digest, actual.cache_ref, now);
    else await store.insertMaterialization({
      runtime_materialization_id: `rpm_${randomUUID().replaceAll("-", "")}`,
      runtime_environment_id: policy.runtime_environment_id, runtime_pool_id: policy.runtime_pool_id,
      runtime_node_id: policy.runtime_node_id, claude_code_plugin_id: expected.claude_code_plugin_id,
      resolved_version: expected.resolved_version, artifact_digest: expected.artifact_digest,
      materialized_digest: actual.materialized_digest, artifact_set_hash: target.artifact_set_hash,
      policy_revision: policy.policy_revision, declaration_status: "declared", materialization_status: "materialized",
      activation_status: "loadable", materialization_key: key,
      attempt_id: `rpa_${randomUUID().replaceAll("-", "")}`, attempt_count: 1,
      verification_status: "verified", retention_state: "local_cache", cache_ref: actual.cache_ref,
      created_at: now, updated_at: now,
    });
  }
}

async function updateOrConflict(store: DeckPluginControlRepository, plan: dto.DeckPluginControlPlan,
  values: Parameters<DeckPluginControlRepository["updateInstallation"]>[2]) {
  const updated = await store.updateInstallation(plan.deck_plugin_installation_id!, plan.expected_revision!, values);
  if (!updated) fail("DECK_PLUGIN_CONCURRENT_MODIFICATION", 409);
  return updated;
}

async function apply(store: DeckPluginControlRepository, principal: Principal, input: dto.DeckPluginControlApplyInput) {
  const current = await buildPlan(store, principal, input.plan.command, "update");
  if (canonicalContractJson(current) !== canonicalContractJson(input.plan)) fail("DECK_PLUGIN_CONCURRENT_MODIFICATION", 409);
  validateEvidence(current, input.evidence);
  const command = current.command, target = current.target_version;
  let phase: "ready" | "upgrade_pending" = "ready", message = `Deck Plugin ${command.action.replaceAll("_", " ")} completed.`;

  if (command.action === "install" && current.deck_plugin_installation_id !== null) {
    message = "Deck Plugin is already installed and ready.";
  } else {
    await persistEvidence(store, current, input.evidence);
    if (command.action === "install") {
      const release = await requiredRelease(store, command.deck_plugin_id, command.deck_plugin_version);
      await store.insertInstallation({ id: `dpi_${randomUUID().replaceAll("-", "")}`, scope_type: command.scope_type,
        scope_id: command.scope_id, deck_plugin_id: command.deck_plugin_id,
        installed_versions_json: JSON.stringify([command.deck_plugin_version]), default_version: command.deck_plugin_version,
        status: "ready", approved_capabilities_json: JSON.stringify(release.manifest.capabilities),
        source_policy_id: current.source_policy_id!, pending_version: null, pending_capabilities_json: null, revision: 1 });
      message = "Deck Plugin installed and runtime lock materialized.";
    } else if (command.action === "enable") {
      await updateOrConflict(store, current, { status: "ready", last_error_code: null, last_error_summary: null });
    } else if (command.action === "disable") {
      await updateOrConflict(store, current, { status: "disabled", last_error_code: "DECK_PLUGIN_DISABLED", last_error_summary: command.reason });
    } else if (command.action === "upgrade" && current.capability_diff.added.length > 0) {
      const release = await requiredRelease(store, command.deck_plugin_id, command.target_version);
      await updateOrConflict(store, current, { status: "upgrade_pending", pending_version: command.target_version,
        pending_capabilities_json: JSON.stringify(release.manifest.capabilities), last_error_code: "DECK_PLUGIN_UPGRADE_APPROVAL_REQUIRED",
        last_error_summary: "capability expansion requires administrator approval" });
      phase = "upgrade_pending"; message = "Upgrade requires capability approval.";
    } else if (command.action === "upgrade" || command.action === "approve_upgrade") {
      const release = await requiredRelease(store, command.deck_plugin_id, target!);
      const row = await store.installation(command.scope_type, command.scope_id, command.deck_plugin_id, "update");
      if (!row || row.id !== current.deck_plugin_installation_id || row.revision !== current.expected_revision) fail("DECK_PLUGIN_CONCURRENT_MODIFICATION", 409);
      const installed = storedStrings(row.installed_versions_json); if (!installed.includes(target!)) installed.push(target!);
      await updateOrConflict(store, current, { installed_versions_json: JSON.stringify(installed), default_version: target,
        status: "ready", approved_capabilities_json: JSON.stringify(release.manifest.capabilities), pending_version: null,
        pending_capabilities_json: null, last_error_code: null, last_error_summary: null });
    } else if (command.action === "rollback") {
      await updateOrConflict(store, current, { default_version: command.target_version, last_error_code: null, last_error_summary: null });
    } else if (command.action === "reject_upgrade") {
      await updateOrConflict(store, current, { status: "ready", pending_version: null, pending_capabilities_json: null,
        last_error_code: null, last_error_summary: null });
      message = "Capability expansion was rejected; the current ready version remains active.";
    } else if (command.action === "uninstall") {
      await updateOrConflict(store, current, { status: "uninstalled", pending_version: null, pending_capabilities_json: null });
    } else if (command.action === "reconcile") {
      message = "Runtime plugin reconcile completed.";
    }
  }
  const updatedAt = pgTimestampToIso(await store.clock()); if (!updatedAt) fail("DECK_PLUGIN_CONTROL_DATA_INVALID", 503);
  return dto.deckPluginControlOperationDto.parse({ operation_id: `op_${randomUUID().replaceAll("-", "")}`,
    deck_plugin_id: command.deck_plugin_id, target_version: target, status: "completed", phase, progress: 100, message, updated_at: updatedAt });
}

export async function runDeckPluginControlOperation(operation: dto.DeckPluginControlOperation, rawInput: unknown,
  rawPrincipal: unknown, tx: DataTransaction) {
  const contract = dto.deckPluginControlOperationContracts[operation];
  if (!contract) fail("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) fail("INPUT_INVALID", 400);
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes(contract.userScope)) fail("DREAM_SCOPE_REQUIRED", 403);
  const store = new DeckPluginControlRepository(tx, principal.canonical_user_id);

  if (operation === "deck-plugin-control.list") {
    const input = dto.deckPluginControlListInputDto.parse(parsed.data);
    await authorize(store, principal, input.scope_type, input.scope_id, "share");
    const installations = [], runtime = new Map<string, unknown>();
    for (const row of await store.activeInstallations(input.scope_type, input.scope_id)) {
      const version = row.default_version ?? row.pending_version; if (!version) continue;
      const projected = await view(store, await requiredRelease(store, row.deck_plugin_id, version), row);
      installations.push(projected);
      for (const item of projected.runtime_plugins) runtime.set(`${item.claude_code_plugin_id}\0${item.resolved_version}`, item);
    }
    return dto.deckPluginControlListDto.parse({ installations, runtime_plugins: [...runtime.values()] });
  }
  if (operation === "deck-plugin-control.version") {
    const input = dto.deckPluginControlVersionInputDto.parse(parsed.data);
    await authorize(store, principal, input.scope_type, input.scope_id, "share");
    const installation = await store.installation(input.scope_type, input.scope_id, input.deck_plugin_id);
    return view(store, await requiredRelease(store, input.deck_plugin_id, input.deck_plugin_version),
      installation && installation.status !== "uninstalled" ? installation : null);
  }
  if (operation === "deck-plugin-control.readiness") {
    const input = dto.deckPluginControlReadinessInputDto.parse(parsed.data);
    await authorize(store, principal, input.scope_type, input.scope_id, "share");
    const installation = await store.installation(input.scope_type, input.scope_id, input.deck_plugin_id);
    if (!installation || !activeStatuses.has(installation.status)) fail("DECK_PLUGIN_UNAVAILABLE", 404);
    const version = installation.default_version ?? installation.pending_version; if (!version) fail("DECK_PLUGIN_RUNTIME_NOT_READY", 409);
    return (await view(store, await requiredRelease(store, input.deck_plugin_id, version), installation)).runtime_readiness;
  }
  if (operation === "deck-plugin-control.plan") {
    return buildPlan(store, principal, dto.deckPluginControlPlanInputDto.parse(parsed.data), "share");
  }
  return apply(store, principal, dto.deckPluginControlApplyInputDto.parse(parsed.data));
}
