// [Input] Strict binding DTOs, mocked typed repositories and existing compatibility fixtures.
// [Output] Owner, binding CAS and evidence-bound Agent-type/launch Runtime preparation behavior.
// [Pos] Provider-free Registry122-132 service verification.
// [Sync] 2026-09-16: cover launch scope plus current and frozen replay Runtime semantics.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { DeckPluginBindingRepository, type DeckPluginBindingRow } from "./deckPluginBindingRepository";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { WorkflowRuntimeActivationRepository } from "./workflowRuntimeActivationRepository";
import {
  deckAgentTypeChatDto,
  deckAgentTypeRuntimePlanDto,
  deckAgentTypeRuntimePreparedDto,
  deckPluginBindingHistoryDto,
  deckPluginBindingResponseDto,
  deckPluginOptionsDto,
  dreamLaunchRuntimePlanDto,
  dreamLaunchRuntimePreparedDto,
  dreamLaunchRuntimeScopeDto,
} from "./deckPluginBindingDto";
import { runDeckPluginBindingOperation } from "./deckPluginBindingService";

const principal = principalDto.parse({ subject: "subject", canonical_user_id: "1", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" });
const scope = { deck_id: "deck", workspace_id: "workspace" };
const selection = { ...scope, deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", apply_to: "next_run" as const };
const runtimePolicy = {
  runtime_environment_id: "local-runtime", runtime_pool_id: "local-runtime", runtime_node_id: "local",
  distribution_mode: "local_persistent" as const, deployment_tier: "local" as const,
  policy_revision: "dream-agent-type/v1", materialization_key_scope: "dream-agent-type",
  session_creating_lease_seconds: 30, required_plugin_id: "example.runtime",
  required_plugin_version: "1.0.0", required_source_type: "platform-builtin" as const,
};
const runtimeFacts = () => {
  const fixture = compatibilityFixture();
  const lock = { ...fixture.lock, production_ready: true, production_readiness_reasons: [],
    claude_code_plugins: fixture.lock.claude_code_plugins.map(item => ({ ...item, capability_bindings: ["story.workspace.propose"] })) };
  return {
    row: { deck_plugin_id: fixture.manifest.deck_plugin_id, deck_plugin_version: fixture.manifest.deck_plugin_version,
      manifest_hash: fixture.release.manifest_hash, capabilities_json: JSON.stringify(fixture.manifest.capabilities),
      release_status: "published",
      runtime_plugin_lock_id: fixture.lock.runtime_plugin_lock_id, deck_plugin_manifest_hash: fixture.release.manifest_hash,
      lock_json: JSON.stringify(lock) },
    installation: { plugin_installation_id: `cpi_${"4".repeat(32)}`, package_spec: "example.runtime", package_name: "runtime",
      marketplace: "platform-builtin", resolved_version: "1.0.0", artifact_digest: fixture.lock.claude_code_plugins[0].artifact_digest,
      artifact_path: "/server-owned/artifact", compatibility_json: "{}", manifest_json: "{}", source_type: "platform-builtin", status: "ready" },
  };
};
const row = (patch: Partial<DeckPluginBindingRow> = {}): DeckPluginBindingRow => ({
  deck_plugin_binding_id: `dpb_${"1".repeat(32)}`, deck_id: "deck", workspace_id: "workspace", creator_id: "1",
  deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", binding_revision: 1, status: "active", applied_to: "next_run",
  created_at: "2026-09-16 00:00:00+00", updated_at: "2026-09-16 00:00:00+00", ...patch,
});

beforeEach(() => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
  vi.stubEnv("INK_DECK_HOST_COMPATIBLE", "true");
  vi.stubEnv("INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "true");
  vi.stubEnv("INK_STORY_SCHEMA_COMPATIBLE", "true");
  vi.stubEnv("INK_DECK_RUNTIME_CONFIG_COMPATIBLE", "true");
  vi.spyOn(DeckPluginBindingRepository.prototype, "ownsDeckWorkspace").mockResolvedValue({ id: "deck" });
  vi.spyOn(DeckPluginBindingRepository.prototype, "ownsEnabledDeckWorkspace").mockResolvedValue({ id: "deck" });
  vi.spyOn(DeckPluginBindingRepository.prototype, "enabledAgent").mockResolvedValue({ id: "agent" });
  const fixture = compatibilityFixture();
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "release").mockResolvedValue(fixture.release);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "installation").mockResolvedValue(fixture.installation);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "lock").mockResolvedValue(fixture.lockFacts);
  vi.spyOn(DeckPluginCompatibilityRepository.prototype, "materializations").mockResolvedValue([{ claude_code_plugin_id: "example.runtime", artifact_digest: fixture.lock.claude_code_plugins[0].artifact_digest,
    materialized_digest: fixture.lock.claude_code_plugins[0].artifact_digest, verification_status: "verified", declaration_status: "declared", materialization_status: "materialized", activation_status: "loaded" }]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Deck Plugin binding Admin service", () => {
  it("denies a foreign Deck/Workspace before reading binding facts", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "ownsDeckWorkspace").mockResolvedValue(null);
    const current = vi.spyOn(DeckPluginBindingRepository.prototype, "current");
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.current", scope, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "DECK_ACCESS_DENIED", status: 404 });
    expect(current).not.toHaveBeenCalled();
  });

  it("returns empty current state and ordered history with exact timestamps", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(null);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(2);
    expect(await runDeckPluginBindingOperation("deck-plugin-binding.current", scope, principal, {} as DataTransaction)).toEqual({ deck_id: "deck", binding_revision: 2, applied_to: "next_run", binding: null });
    vi.spyOn(DeckPluginBindingRepository.prototype, "history").mockResolvedValue([row({ binding_revision: 2 }), row({ deck_plugin_binding_id: `dpb_${"2".repeat(32)}`, binding_revision: 1, status: "stale" })]);
    const history = deckPluginBindingHistoryDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.history", { ...scope, limit: 50 }, principal, {} as DataTransaction));
    expect(history.entries.map(item => item.binding_revision)).toEqual([2, 1]);
    expect(history.entries[0].created_at).toBe("2026-09-16T00:00:00+00:00");
  });

  it("maps selectable, disabled and revoked options without accepting readiness input", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "selectableReleases").mockResolvedValue([
      { display_name: "Story", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", status: "published" },
      { display_name: "Revoked", deck_plugin_id: "example.revoked", deck_plugin_version: "1.0.0", status: "revoked" },
    ]);
    vi.mocked(DeckPluginCompatibilityRepository.prototype.release).mockImplementation(async pluginId => (
      pluginId === "example.revoked"
        ? { ...compatibilityFixture().release, deck_plugin_id: pluginId, status: "revoked" }
        : compatibilityFixture().release
    ));
    const result = deckPluginOptionsDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.options", scope, principal, {} as DataTransaction));
    expect(result.options[0]).toMatchObject({ selectable: true, runtime_readiness: "materialized" });
    expect(result.options[1]).toMatchObject({ selectable: false, reason_code: "DECK_PLUGIN_UNAVAILABLE", release_status: "revoked" });
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.validate", { ...selection, ready: true }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  });

  it("rejects stale CAS and exposes only the current revision", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 0 }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "BINDING_REVISION_CONFLICT", status: 409, details: { current_revision: 1 } });
  });

  it("keeps same selection idempotent without insert or draft advance", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    const insert = vi.spyOn(DeckPluginBindingRepository.prototype, "insert");
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision");
    const result = deckPluginBindingResponseDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 1 }, principal, {} as DataTransaction));
    expect(result.binding_revision).toBe(1); expect(insert).not.toHaveBeenCalled(); expect(advance).not.toHaveBeenCalled();
  });

  it("stales the prior row, inserts revision and advances the Deck in the same caller UOW", async () => {
    const prior = row({ deck_plugin_id: "example.prior" });
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(prior);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    const stale = vi.spyOn(DeckPluginBindingRepository.prototype, "markCurrentStale").mockResolvedValue(true);
    const inserted = row({ deck_plugin_binding_id: `dpb_${"3".repeat(32)}`, binding_revision: 2 });
    const insert = vi.spyOn(DeckPluginBindingRepository.prototype, "insert").mockResolvedValue(inserted);
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision").mockResolvedValue();
    const result = deckPluginBindingResponseDto.parse(await runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 1 }, principal, {} as DataTransaction));
    expect(result.binding_revision).toBe(2); expect(stale).toHaveBeenCalledWith(prior.deck_plugin_binding_id, 1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ binding_revision: 2 })); expect(advance).toHaveBeenCalledWith("deck");
  });

  it("returns structured selection rejection from current server facts", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(null);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(0);
    vi.spyOn(DeckPluginCompatibilityRepository.prototype, "installation").mockResolvedValue({ ...compatibilityFixture().installation, status: "disabled" });
    await expect(runDeckPluginBindingOperation("deck-plugin-binding.save", { ...selection, expected_binding_revision: 0 }, principal, {} as DataTransaction))
      .rejects.toMatchObject({ code: "SELECTION_NOT_ALLOWED", status: 422, details: { validation: { reason_code: "DECK_PLUGIN_DISABLED" } } });
  });

  it("clears an active binding without inventing a new binding revision", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(1);
    const stale = vi.spyOn(DeckPluginBindingRepository.prototype, "markCurrentStale").mockResolvedValue(true);
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision").mockResolvedValue();
    const result = deckAgentTypeChatDto.parse(await runDeckPluginBindingOperation(
      "deck-plugin-binding.clear", { ...scope, expected_binding_revision: 1 }, principal, {} as DataTransaction,
    ));
    expect(result).toEqual({ deck_id: "deck", agent_type: "chat", binding_revision: 1 });
    expect(stale).toHaveBeenCalledWith(row().deck_plugin_binding_id, 1);
    expect(advance).toHaveBeenCalledWith("deck");
  });

  it("keeps Chat clear idempotent when no active binding exists", async () => {
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(null);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(3);
    const stale = vi.spyOn(DeckPluginBindingRepository.prototype, "markCurrentStale");
    const advance = vi.spyOn(DeckPluginBindingRepository.prototype, "advanceDraftRevision");
    expect(await runDeckPluginBindingOperation(
      "deck-plugin-binding.clear", { ...scope, expected_binding_revision: 3 }, principal, {} as DataTransaction,
    )).toEqual({ deck_id: "deck", agent_type: "chat", binding_revision: 3 });
    expect(stale).not.toHaveBeenCalled(); expect(advance).not.toHaveBeenCalled();
  });

  it("plans the single server-selected Runtime target without exposing its path", async () => {
    const facts = runtimeFacts();
    vi.spyOn(DeckPluginBindingRepository.prototype, "runtimeTargets").mockResolvedValue([facts.row]);
    vi.spyOn(DeckPluginBindingRepository.prototype, "readyRuntimeInstallation").mockResolvedValue(facts.installation);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(4);
    const result = deckAgentTypeRuntimePlanDto.parse(await runDeckPluginBindingOperation(
      "deck-agent-type.runtime-plan", scope, principal, {} as DataTransaction, runtimePolicy,
    ));
    expect(result).toMatchObject({ deck_id: "deck", current_binding_revision: 4,
      target: { package_spec: "example.runtime", resolved_version: "1.0.0" } });
    expect(result.target).not.toHaveProperty("artifact_path");
    expect(result.target).not.toHaveProperty("cache_ref");
  });

  it("rejects Runtime preparation when local evidence differs from Admin installation facts", async () => {
    const facts = runtimeFacts();
    vi.spyOn(DeckPluginBindingRepository.prototype, "runtimeTargets").mockResolvedValue([facts.row]);
    vi.spyOn(DeckPluginBindingRepository.prototype, "readyRuntimeInstallation").mockResolvedValue(facts.installation);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(4);
    await expect(runDeckPluginBindingOperation("deck-agent-type.runtime-prepare", {
      ...scope, expected_binding_revision: 4,
      verified_plugin: { plugin_installation_id: facts.installation.plugin_installation_id,
        package_spec: facts.installation.package_spec, resolved_version: facts.installation.resolved_version,
        artifact_digest: `sha256:${"f".repeat(64)}`, has_manifest: true },
    }, principal, {} as DataTransaction, runtimePolicy)).rejects.toMatchObject({ code: "RUNTIME_PLUGIN_NOT_READY", status: 409 });
  });

  it("prepares materialization and Workspace installation from Admin-owned ORM facts", async () => {
    const facts = runtimeFacts();
    vi.spyOn(DeckPluginBindingRepository.prototype, "runtimeTargets").mockResolvedValue([facts.row]);
    vi.spyOn(DeckPluginBindingRepository.prototype, "readyRuntimeInstallation").mockResolvedValue(facts.installation);
    vi.spyOn(DeckPluginBindingRepository.prototype, "latestRevision").mockResolvedValue(4);
    vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "clock").mockResolvedValue("2026-09-16T01:02:03+00:00");
    vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "materializationByKey").mockResolvedValue(null);
    const insertMaterialization = vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "insertMaterialization").mockResolvedValue();
    vi.spyOn(DeckPluginBindingRepository.prototype, "workspaceInstallation").mockResolvedValue(null);
    const workspaceRow = { id: `dpi_${"5".repeat(32)}`, scope_type: "workspace", scope_id: "workspace", deck_plugin_id: "example.story",
      installed_versions_json: '["1.0.0"]', default_version: "1.0.0", status: "ready",
      approved_capabilities_json: '["story.workspace.propose"]', source_policy_id: "system:dream-agent-type/v1",
      last_error_code: null, last_error_summary: null, pending_version: null, pending_capabilities_json: null,
      revision: 1, created_at: "2026-09-16 00:00:00+00", updated_at: "2026-09-16 00:00:00+00" };
    const insertWorkspace = vi.spyOn(DeckPluginBindingRepository.prototype, "insertReadyWorkspaceInstallation").mockResolvedValue(workspaceRow);
    const result = deckAgentTypeRuntimePreparedDto.parse(await runDeckPluginBindingOperation("deck-agent-type.runtime-prepare", {
      ...scope, expected_binding_revision: 4,
      verified_plugin: { plugin_installation_id: facts.installation.plugin_installation_id,
        package_spec: facts.installation.package_spec, resolved_version: facts.installation.resolved_version,
        artifact_digest: facts.installation.artifact_digest, has_manifest: true },
    }, principal, {} as DataTransaction, runtimePolicy));
    expect(result).toEqual({ deck_id: "deck", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0",
      current_binding_revision: 4, runtime_ready: true });
    expect(insertMaterialization).toHaveBeenCalledWith(expect.objectContaining({ cache_ref: "/server-owned/artifact",
      materialization_status: "materialized", activation_status: "loadable" }));
    expect(insertWorkspace).toHaveBeenCalledWith("workspace", "example.story", "1.0.0", ["story.workspace.propose"]);
  });

  it("authorizes launch Deck, Workspace and optional Voice before Runtime planning", async () => {
    const input = { ...scope, agent_id: "agent" };
    expect(dreamLaunchRuntimeScopeDto.parse(await runDeckPluginBindingOperation(
      "dream-launch.runtime-scope", input, principal, {} as DataTransaction, runtimePolicy,
    ))).toEqual({ ...input, authorized: true });
    vi.mocked(DeckPluginBindingRepository.prototype.enabledAgent).mockResolvedValueOnce(null);
    await expect(runDeckPluginBindingOperation(
      "dream-launch.runtime-scope", input, principal, {} as DataTransaction, runtimePolicy,
    )).rejects.toMatchObject({ code: "AGENT_ACCESS_DENIED", status: 404 });
  });

  it("plans and prepares the current explicit launch binding without returning an artifact path", async () => {
    const facts = runtimeFacts();
    vi.spyOn(DeckPluginBindingRepository.prototype, "current").mockResolvedValue(row());
    vi.spyOn(DeckPluginBindingRepository.prototype, "runtimeTargets").mockResolvedValue([facts.row]);
    vi.spyOn(DeckPluginBindingRepository.prototype, "readyRuntimeInstallation").mockResolvedValue(facts.installation);
    const input = { ...scope, agent_id: null, mode: "current" as const, workflow_run_id: null, thread_id: null };
    const plan = dreamLaunchRuntimePlanDto.parse(await runDeckPluginBindingOperation(
      "dream-launch.runtime-plan", input, principal, {} as DataTransaction, runtimePolicy,
    ));
    expect(plan).toMatchObject({ mode: "current", binding: { deck_plugin_binding_id: row().deck_plugin_binding_id,
      binding_revision: 1 }, target: { plugin_installation_id: facts.installation.plugin_installation_id } });
    expect(plan.target).not.toHaveProperty("artifact_path");
    vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "clock").mockResolvedValue("2026-09-16T02:03:04+00:00");
    vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "materializationByKey").mockResolvedValue({ id: "existing" });
    const refresh = vi.spyOn(WorkflowRuntimeActivationRepository.prototype, "refreshMaterialization").mockResolvedValue();
    vi.spyOn(DeckPluginBindingRepository.prototype, "workspaceInstallation").mockResolvedValue({
      id: "installation", status: "ready", default_version: "1.0.0", installed_versions_json: '["1.0.0"]',
    } as never);
    const prepared = dreamLaunchRuntimePreparedDto.parse(await runDeckPluginBindingOperation(
      "dream-launch.runtime-prepare", { ...input, expected_binding_revision: 1,
        verified_plugin: { plugin_installation_id: facts.installation.plugin_installation_id,
          package_spec: facts.installation.package_spec, resolved_version: facts.installation.resolved_version,
          artifact_digest: facts.installation.artifact_digest, has_manifest: true } },
      principal, {} as DataTransaction, runtimePolicy,
    ));
    expect(prepared).toMatchObject({ mode: "current", binding: { binding_revision: 1 }, runtime_ready: true });
    expect(refresh).toHaveBeenCalledWith("existing", facts.installation.artifact_digest,
      "/server-owned/artifact", "2026-09-16T02:03:04.000Z");
  });

  it("derives replay binding and frozen lock from the actor-owned Run", async () => {
    const facts = runtimeFacts();
    const workflowRunId = `run_${"a".repeat(32)}`;
    const replay = { workflow_run_id: workflowRunId, thread_id: "thread", workspace_id: "workspace",
      deck_plugin_id: "example.story", deck_plugin_version: "1.0.0",
      deck_plugin_manifest_hash: facts.row.manifest_hash, deck_plugin_binding_id: row().deck_plugin_binding_id,
      binding_revision: 1, runtime_plugin_lock_id: facts.row.runtime_plugin_lock_id,
      preflight_deck_id: "deck", binding_deck_id: "deck", binding_workspace_id: "workspace",
      binding_creator_id: "1", binding_plugin_id: "example.story", binding_plugin_version: "1.0.0",
      binding_revision_actual: 1 };
    vi.spyOn(DeckPluginBindingRepository.prototype, "replayBinding").mockResolvedValue(replay);
    vi.spyOn(DeckPluginBindingRepository.prototype, "runtimeTargetByLock").mockResolvedValue(facts.row);
    vi.spyOn(DeckPluginBindingRepository.prototype, "readyRuntimeInstallation").mockResolvedValue(facts.installation);
    const current = vi.spyOn(DeckPluginBindingRepository.prototype, "current");
    const input = { ...scope, agent_id: "agent", mode: "replay" as const,
      workflow_run_id: workflowRunId, thread_id: "thread" };
    const plan = dreamLaunchRuntimePlanDto.parse(await runDeckPluginBindingOperation(
      "dream-launch.runtime-plan", input, principal, {} as DataTransaction, runtimePolicy,
    ));
    expect(plan).toMatchObject({ mode: "replay", workflow_run_id: workflowRunId,
      binding: { deck_plugin_binding_id: replay.deck_plugin_binding_id, binding_revision: 1 },
      target: { runtime_plugin_lock_id: replay.runtime_plugin_lock_id } });
    expect(DeckPluginBindingRepository.prototype.replayBinding).toHaveBeenCalledWith(
      workflowRunId, "thread", "deck", "workspace", "share",
    );
    expect(current).not.toHaveBeenCalled();
  });
});
