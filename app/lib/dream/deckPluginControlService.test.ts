// [Input] Strict control DTOs, mocked typed Repository facts and immutable Runtime lock evidence.
// [Output] Owner/admin, plan/apply, state transition, evidence and revision failure verification.
// [Pos] Provider-free Registry170-174 domain tests; no database, filesystem or Runtime process.
// [Sync] 2026-09-16: verify the Admin-owned Deck Plugin control aggregate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import { DeckPluginControlRepository } from "./deckPluginControlRepository";
import { deckPluginControlApplyInputDto, deckPluginControlPlanDto } from "./deckPluginControlDto";
import { runDeckPluginControlOperation } from "./deckPluginControlService";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:read", "dream:write"], status: "active" as const };
const tx = {} as DataTransaction;
const scope = { scope_type: "workspace" as const, scope_id: "workspace", deck_plugin_id: "example.story" };
const digest = `sha256:${"c".repeat(64)}`;

function release(version = "1.0.0", capabilities = ["story.workspace.propose"]) {
  const fixture = compatibilityFixture();
  const manifest = { ...fixture.manifest, deck_plugin_version: version, capabilities,
    runtime: { ...fixture.manifest.runtime, claude_code_plugins: fixture.manifest.runtime.claude_code_plugins.map(item => ({ ...item, version_constraint: version })) } };
  const lock = { ...fixture.lock, deck_plugin_version: version,
    claude_code_plugins: fixture.lock.claude_code_plugins.map(item => ({ ...item, resolved_version: version })) };
  return { id: `dpr_${version.replaceAll(".", "")}`, deck_plugin_id: manifest.deck_plugin_id,
    deck_plugin_version: version, display_name: manifest.display_name, status: "published", manifest_json: JSON.stringify(manifest),
    manifest_hash: lock.deck_plugin_manifest_hash, updated_at: "2026-09-16 00:00:00.123456+00",
    runtime_plugin_lock_id: lock.runtime_plugin_lock_id, deck_plugin_manifest_hash: lock.deck_plugin_manifest_hash,
    lock_json: JSON.stringify(lock) };
}

function installation(patch: Record<string, unknown> = {}) {
  return { id: `dpi_${"d".repeat(32)}`, scope_type: "workspace", scope_id: "workspace", deck_plugin_id: "example.story",
    installed_versions_json: '["1.0.0"]', default_version: "1.0.0", status: "ready",
    approved_capabilities_json: '["story.workspace.propose"]', source_policy_id: "controlled:package:example",
    last_error_code: null, last_error_summary: null, pending_version: null, pending_capabilities_json: null,
    revision: 1, created_at: "2026-09-16 00:00:00.123456+00", updated_at: "2026-09-16 00:00:00.123456+00", ...patch };
}

function evidence(version = "1.0.0") {
  return [{ claude_code_plugin_id: "example.runtime", resolved_version: version, artifact_digest: digest,
    materialized_digest: digest, cache_ref: "/server-owned/plugin", has_manifest: true as const }];
}

beforeEach(() => {
  vi.stubEnv("DREAM_RUNTIME_ACTIVATION_POLICY_JSON", JSON.stringify({ runtime_environment_id: "ink-local",
    runtime_pool_id: "ink-local", runtime_node_id: "local", distribution_mode: "local_persistent",
    deployment_tier: "local", policy_revision: "deck-admin/v1", materialization_key_scope: "local",
    session_creating_lease_seconds: 30, required_plugin_id: "example.runtime", required_plugin_version: "1.0.0",
    required_source_type: "platform-builtin" }));
  vi.spyOn(DeckPluginControlRepository.prototype, "ownedWorkspace").mockResolvedValue({ id: "workspace" });
  vi.spyOn(DeckPluginControlRepository.prototype, "actorRole").mockResolvedValue({ role: "user" });
  vi.spyOn(DeckPluginControlRepository.prototype, "serialize").mockResolvedValue(undefined);
  vi.spyOn(DeckPluginControlRepository.prototype, "release").mockImplementation(async (_plugin, version) => release(version));
  vi.spyOn(DeckPluginControlRepository.prototype, "availableVersions").mockResolvedValue([{ version: "1.0.0" }]);
  vi.spyOn(DeckPluginControlRepository.prototype, "installation").mockResolvedValue(null);
  vi.spyOn(DeckPluginControlRepository.prototype, "activeInstallations").mockResolvedValue([]);
  vi.spyOn(DeckPluginControlRepository.prototype, "latestMaterialization").mockResolvedValue(null);
  vi.spyOn(DeckPluginControlRepository.prototype, "materializationByKey").mockResolvedValue(null);
  vi.spyOn(DeckPluginControlRepository.prototype, "insertMaterialization").mockResolvedValue(undefined);
  vi.spyOn(DeckPluginControlRepository.prototype, "refreshMaterialization").mockResolvedValue(undefined);
  vi.spyOn(DeckPluginControlRepository.prototype, "insertInstallation").mockResolvedValue(installation() as never);
  vi.spyOn(DeckPluginControlRepository.prototype, "updateInstallation").mockResolvedValue(installation({ revision: 2 }) as never);
  vi.spyOn(DeckPluginControlRepository.prototype, "clock").mockResolvedValue("2026-09-16 00:00:00.123456+00");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("Deck Plugin control Admin domain", () => {
  it("builds an immutable install plan and atomically consumes exact local evidence", async () => {
    const command = { action: "install" as const, ...scope, deck_plugin_version: "1.0.0",
      source_type: "controlled" as const, source: "package:example" };
    const plan = deckPluginControlPlanDto.parse(await runDeckPluginControlOperation("deck-plugin-control.plan", command, principal, tx));
    expect(plan).toMatchObject({ expected_revision: null, target_version: "1.0.0", requires_runtime_evidence: true,
      capability_diff: { added: ["story.workspace.propose"], removed: [] } });
    const result = await runDeckPluginControlOperation("deck-plugin-control.apply", { plan, evidence: evidence() }, principal, tx);
    expect(result).toMatchObject({ deck_plugin_id: "example.story", target_version: "1.0.0", phase: "ready" });
    expect(DeckPluginControlRepository.prototype.insertMaterialization).toHaveBeenCalledTimes(1);
    expect(DeckPluginControlRepository.prototype.insertInstallation).toHaveBeenCalledWith(expect.objectContaining({
      status: "ready", installed_versions_json: '["1.0.0"]', source_policy_id: "controlled:package:example" }));
  });

  it("keeps capability expansion pending without accepting caller readiness evidence", async () => {
    vi.mocked(DeckPluginControlRepository.prototype.installation).mockResolvedValue(installation() as never);
    vi.mocked(DeckPluginControlRepository.prototype.release).mockImplementation(async (_plugin, version) =>
      release(version, ["story.workspace.propose", "network.external.call"]));
    const command = { action: "upgrade" as const, ...scope, target_version: "2.0.0" };
    const plan = deckPluginControlPlanDto.parse(await runDeckPluginControlOperation("deck-plugin-control.plan", command, principal, tx));
    expect(plan).toMatchObject({ requires_runtime_evidence: false, capability_diff: { added: ["network.external.call"], removed: [] } });
    await expect(runDeckPluginControlOperation("deck-plugin-control.apply", { plan, evidence: evidence("2.0.0") }, principal, tx))
      .rejects.toMatchObject({ code: "DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID", status: 400 });
    const result = await runDeckPluginControlOperation("deck-plugin-control.apply", { plan, evidence: [] }, principal, tx);
    expect(result).toMatchObject({ phase: "upgrade_pending", target_version: "2.0.0" });
    expect(DeckPluginControlRepository.prototype.updateInstallation).toHaveBeenCalledWith(plan.deck_plugin_installation_id, 1,
      expect.objectContaining({ status: "upgrade_pending", pending_version: "2.0.0" }));
  });

  it("rejects stale revision, foreign Workspace, local source and forged authority selectors", async () => {
    vi.mocked(DeckPluginControlRepository.prototype.installation).mockResolvedValue(installation() as never);
    const command = { action: "disable" as const, ...scope, reason: "maintenance" };
    const plan = deckPluginControlPlanDto.parse(await runDeckPluginControlOperation("deck-plugin-control.plan", command, principal, tx));
    vi.mocked(DeckPluginControlRepository.prototype.installation).mockResolvedValue(installation({ revision: 2 }) as never);
    await expect(runDeckPluginControlOperation("deck-plugin-control.apply", { plan, evidence: [] }, principal, tx))
      .rejects.toMatchObject({ code: "DECK_PLUGIN_CONCURRENT_MODIFICATION", status: 409 });
    vi.mocked(DeckPluginControlRepository.prototype.ownedWorkspace).mockResolvedValue(null);
    await expect(runDeckPluginControlOperation("deck-plugin-control.plan", command, principal, tx))
      .rejects.toMatchObject({ code: "WORKFLOW_PERMISSION_DENIED", status: 403 });
    vi.mocked(DeckPluginControlRepository.prototype.ownedWorkspace).mockResolvedValue({ id: "workspace" });
    await expect(runDeckPluginControlOperation("deck-plugin-control.plan", { action: "install", ...scope,
      deck_plugin_version: "1.0.0", source_type: "local", source: "/tmp/plugin" }, principal, tx))
      .rejects.toMatchObject({ code: "DECK_PLUGIN_SOURCE_DENIED", status: 403 });
    for (const key of ["actor_id", "user_id", "role", "sql", "table", "column", "transaction"])
      await expect(runDeckPluginControlOperation("deck-plugin-control.plan", { ...command, [key]: "caller" }, principal, tx))
        .rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  });

  it("rechecks instance admin role and returns owner-scoped list/readiness projections", async () => {
    await expect(runDeckPluginControlOperation("deck-plugin-control.list", { scope_type: "instance", scope_id: "instance" }, principal, tx))
      .rejects.toMatchObject({ code: "WORKFLOW_PERMISSION_DENIED", status: 403 });
    vi.mocked(DeckPluginControlRepository.prototype.actorRole).mockResolvedValue({ role: "admin" });
    vi.mocked(DeckPluginControlRepository.prototype.activeInstallations).mockResolvedValue([installation() as never]);
    vi.mocked(DeckPluginControlRepository.prototype.installation).mockResolvedValue(installation() as never);
    vi.mocked(DeckPluginControlRepository.prototype.latestMaterialization).mockResolvedValue({
      runtime_materialization_id: "rpm", declaration_status: "declared", materialization_status: "materialized",
      activation_status: "loadable", verification_status: "verified", last_error: null,
      updated_at: "2026-09-16 00:00:00.123456+00" } as never);
    const list = await runDeckPluginControlOperation("deck-plugin-control.list", { scope_type: "instance", scope_id: "instance" }, principal, tx);
    expect(list).toHaveProperty("installations.0.runtime_readiness.materialization_status", "materialized");
    const ready = await runDeckPluginControlOperation("deck-plugin-control.readiness", { scope_type: "instance", scope_id: "instance", deck_plugin_id: "example.story" }, principal, tx);
    expect(ready).toEqual({ declaration_status: "declared", materialization_status: "materialized", activation_status: "loadable" });
  });

  it("rejects missing or mismatched evidence before all writes", async () => {
    const command = { action: "install" as const, ...scope, deck_plugin_version: "1.0.0",
      source_type: "controlled" as const, source: "package:example" };
    const plan = deckPluginControlPlanDto.parse(await runDeckPluginControlOperation("deck-plugin-control.plan", command, principal, tx));
    for (const changed of [[], evidence().map(item => ({ ...item, artifact_digest: `sha256:${"e".repeat(64)}` })),
      evidence().map(item => ({ ...item, cache_ref: "" }))]) {
      const input = deckPluginControlApplyInputDto.safeParse({ plan, evidence: changed });
      if (!input.success) continue;
      await expect(runDeckPluginControlOperation("deck-plugin-control.apply", input.data, principal, tx))
        .rejects.toMatchObject({ code: "DECK_PLUGIN_RUNTIME_EVIDENCE_INVALID" });
    }
    expect(DeckPluginControlRepository.prototype.insertInstallation).not.toHaveBeenCalled();
  });
});
