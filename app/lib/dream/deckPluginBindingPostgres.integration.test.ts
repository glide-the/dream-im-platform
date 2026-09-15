// [Input] Named disposable PostgreSQL, restricted role and Registry122-129 DTO-Service-Drizzle path.
// [Output] Binding CAS plus evidence-bound Runtime plan/materialization/Workspace installation evidence.
// [Pos] Isolated destructive technical contract; never uses normal business data.
// [Sync] 2026-09-16: verify Agent-type preparation through the restricted Admin executor.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import {
  deckAgentTypeChatDto,
  deckAgentTypeRuntimePlanDto,
  deckAgentTypeRuntimePreparedDto,
  deckPluginBindingHistoryDto,
  deckPluginBindingResponseDto,
  deckPluginBindingStateDto,
  deckPluginBindingValidationDto,
  deckPluginOptionsDto,
} from "./deckPluginBindingDto";
import { runDeckPluginBindingOperation } from "./deckPluginBindingService";

const adminUrl = process.env.DECK_PLUGIN_BINDING_TEST_ADMIN_URL;
const restrictedUrl = process.env.DECK_PLUGIN_BINDING_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const fixture = compatibilityFixture();
const deckId = "deck-binding-1";
const concurrentDeckId = "deck-binding-race";
const workspaceId = "workspace-binding-1";
const runtimeDeckId = "deck-binding-runtime";
const runtimeWorkspaceId = "workspace-binding-runtime";
const principal = (id: string) => ({ subject: `binding-subject-${id}`, canonical_user_id: id,
  client_id: "dream-browser", scopes: ["dream:read", "dream:write"], status: "active" });
const selection = (targetDeck = deckId) => ({ deck_id: targetDeck, workspace_id: workspaceId,
  deck_plugin_id: fixture.manifest.deck_plugin_id, deck_plugin_version: fixture.manifest.deck_plugin_version,
  apply_to: "next_run" as const });
const runtimePolicy = {
  runtime_environment_id: "binding-runtime", runtime_pool_id: "binding-runtime", runtime_node_id: "binding-node",
  distribution_mode: "local_persistent" as const, deployment_tier: "local" as const,
  policy_revision: "binding-policy/v1", materialization_key_scope: "dream-agent-type",
  session_creating_lease_seconds: 30, required_plugin_id: fixture.lock.claude_code_plugins[0].claude_code_plugin_id,
  required_plugin_version: fixture.lock.claude_code_plugins[0].resolved_version,
  required_source_type: "platform-builtin" as const,
};

describe.skipIf(!enabled)("Deck Plugin binding PostgreSQL contract", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const restrictedPool = new pg.Pool({ connectionString: restrictedUrl, max: 6 });
  const database = drizzle(restrictedPool);

  beforeAll(async () => {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    expect(String(identity.rows[0].database)).toMatch(/^ink_deck_plugin_binding_test_[a-z0-9_]+$/);
    expect(String(identity.rows[0].actor)).toBe("postgres");
    await admin.query(`
      INSERT INTO users (id, email, password_hash) VALUES
        (1, 'binding-one@example.invalid', 'fixture'),
        (2, 'binding-two@example.invalid', 'fixture');
      INSERT INTO story_workspace_workspaces (id, name, owner_id, settings) VALUES
        ('${workspaceId}', 'Binding Workspace', 1, '{}'),
        ('${runtimeWorkspaceId}', 'Runtime Workspace', 1, '{}'),
        ('workspace-binding-2', 'Foreign Workspace', 2, '{}');
      INSERT INTO decks (id, name, owner_id, draft_revision) VALUES
        ('${deckId}', 'Binding Deck', 1, 1),
        ('${concurrentDeckId}', 'Binding Race Deck', 1, 1),
        ('${runtimeDeckId}', 'Binding Runtime Deck', 1, 1),
        ('deck-binding-foreign', 'Foreign Deck', 2, 1);
    `);
    await admin.query(`INSERT INTO deck_plugin_releases
      (id, deck_plugin_id, deck_plugin_version, display_name, status, manifest_json,
       manifest_hash, workflow_definition_ref, capabilities_json)
      VALUES ($1,$2,$3,$4,'published',$5,$6,$7,$8),
             ($9,'example.revoked','1.0.0','Revoked','revoked',$10,$11,'workflow','[]')`, [
      `dpr_${"1".repeat(32)}`, fixture.manifest.deck_plugin_id, fixture.manifest.deck_plugin_version,
      fixture.manifest.display_name, JSON.stringify(fixture.manifest), fixture.release.manifest_hash,
      fixture.release.workflow_definition_ref, JSON.stringify(fixture.manifest.capabilities),
      `dpr_${"2".repeat(32)}`, JSON.stringify({ ...fixture.manifest, deck_plugin_id: "example.revoked" }),
      `sha256:${"d".repeat(64)}`,
    ]);
    await admin.query(`INSERT INTO deck_runtime_plugin_locks
      (id, deck_plugin_id, deck_plugin_version, deck_plugin_manifest_hash, lock_json)
      VALUES ($1,$2,$3,$4,$5)`, [fixture.lock.runtime_plugin_lock_id, fixture.manifest.deck_plugin_id,
      fixture.manifest.deck_plugin_version, fixture.release.manifest_hash, JSON.stringify({ ...fixture.lock,
        production_ready: true, production_readiness_reasons: [], claude_code_plugins: fixture.lock.claude_code_plugins.map(item => ({
          ...item, capability_bindings: ["story.workspace.propose"],
        })) })]);
    await admin.query(`INSERT INTO claude_plugin_installations
      (id, requested_package_spec, package_name, marketplace, resolved_version, source_type,
       artifact_digest, artifact_path, claude_cli_version, manifest_json, compatibility_json,
       status, operation_id, file_count, installed_at)
      VALUES ($1,$2,'runtime','platform-builtin',$3,'platform-builtin',$4,$5,'2.0.0','{}','{}','ready',$6,1,NOW())`, [
      `cpi_${"4".repeat(32)}`, fixture.lock.claude_code_plugins[0].claude_code_plugin_id,
      fixture.lock.claude_code_plugins[0].resolved_version, fixture.lock.claude_code_plugins[0].artifact_digest,
      "/server-owned/binding-runtime", `cop_${"6".repeat(32)}`,
    ]);
    await admin.query(`INSERT INTO deck_plugin_installations
      (id, scope_type, scope_id, deck_plugin_id, installed_versions_json,
       default_version, status, approved_capabilities_json, source_policy_id)
      VALUES ($1,'workspace',$2,$3,$4,$5,'ready',$6,'binding-test-policy')`, [
      fixture.installation.id, workspaceId, fixture.manifest.deck_plugin_id,
      fixture.installation.installed_versions_json, fixture.manifest.deck_plugin_version,
      fixture.installation.approved_capabilities_json,
    ]);
    await admin.query(`INSERT INTO runtime_plugin_materializations
      (runtime_materialization_id, runtime_environment_id, runtime_pool_id, runtime_node_id,
       claude_code_plugin_id, resolved_version, artifact_digest, materialized_digest,
       artifact_set_hash, policy_revision, declaration_status, materialization_status,
       activation_status, materialization_key, attempt_id, attempt_count, verification_status,
       created_at, updated_at)
      VALUES ($1,'binding-pool','binding-pool','binding-node',$2,$3,$4,$4,$5,'1',
       'declared','materialized','loaded','binding-key','binding-attempt',1,'verified',NOW(),NOW())`, [
      `rpm_${"3".repeat(32)}`, fixture.lock.claude_code_plugins[0].claude_code_plugin_id,
      fixture.lock.claude_code_plugins[0].resolved_version,
      fixture.lock.claude_code_plugins[0].artifact_digest, `sha256:${"e".repeat(64)}`,
    ]);
  });

  afterAll(async () => { await restrictedPool.end(); await admin.end(); });

  it("projects current/options/validation from owner-scoped ORM facts", async () => {
    const current = deckPluginBindingStateDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.current", { deck_id: deckId, workspace_id: workspaceId }, principal("1"), tx)));
    expect(current).toEqual({ deck_id: deckId, binding_revision: 0, applied_to: "next_run", binding: null });
    const options = deckPluginOptionsDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.options", { deck_id: deckId, workspace_id: workspaceId }, principal("1"), tx)));
    expect(options.options).toHaveLength(2);
    expect(options.options.find(item => item.deck_plugin_id === fixture.manifest.deck_plugin_id))
      .toMatchObject({ selectable: true, runtime_readiness: "materialized" });
    expect(options.options.find(item => item.deck_plugin_id === "example.revoked"))
      .toMatchObject({ selectable: false, release_status: "revoked", reason_code: "DECK_PLUGIN_UNAVAILABLE" });
    const validation = deckPluginBindingValidationDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.validate", selection(), principal("1"), tx)));
    expect(validation.validation).toMatchObject({ selectable: true, compatibility: "passed" });
  });

  it("commits one revision, preserves same-selection idempotency and returns history", async () => {
    const first = deckPluginBindingResponseDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.save", { ...selection(), expected_binding_revision: 0 }, principal("1"), tx)));
    expect(first).toMatchObject({ deck_id: deckId, binding_revision: 1, status: "active" });
    const exact = deckPluginBindingResponseDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.save", { ...selection(), expected_binding_revision: 1 }, principal("1"), tx)));
    expect(exact).toEqual(first);
    const history = deckPluginBindingHistoryDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.history", { deck_id: deckId, workspace_id: workspaceId, limit: 50 }, principal("1"), tx)));
    expect(history.entries).toHaveLength(1);
    expect(history).toMatchObject({ current_binding_revision: 1, entries: [{ binding_revision: 1, status: "active" }] });
    const stored = await admin.query("SELECT draft_revision FROM decks WHERE id=$1", [deckId]);
    expect(stored.rows[0].draft_revision).toBe(2);
  });

  it("clears Chat with the prior revision and changes the draft only once", async () => {
    const before = (await admin.query("SELECT draft_revision FROM decks WHERE id=$1", [deckId])).rows[0].draft_revision;
    const cleared = deckAgentTypeChatDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.clear", { deck_id: deckId, workspace_id: workspaceId, expected_binding_revision: 1 }, principal("1"), tx)));
    expect(cleared).toEqual({ deck_id: deckId, agent_type: "chat", binding_revision: 1 });
    const repeated = deckAgentTypeChatDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.clear", { deck_id: deckId, workspace_id: workspaceId, expected_binding_revision: 1 }, principal("1"), tx)));
    expect(repeated).toEqual(cleared);
    expect((await admin.query("SELECT draft_revision FROM decks WHERE id=$1", [deckId])).rows[0].draft_revision).toBe(before + 1);
  });

  it("prepares the Admin-selected Runtime target and then commits the binding", async () => {
    const scope = { deck_id: runtimeDeckId, workspace_id: runtimeWorkspaceId };
    const plan = deckAgentTypeRuntimePlanDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-agent-type.runtime-plan", scope, principal("1"), tx, runtimePolicy)));
    expect(plan).toMatchObject({ deck_id: runtimeDeckId, current_binding_revision: 0,
      target: { package_spec: runtimePolicy.required_plugin_id, artifact_digest: fixture.lock.claude_code_plugins[0].artifact_digest } });
    expect(plan.target).not.toHaveProperty("artifact_path");
    const evidence = { plugin_installation_id: plan.target.plugin_installation_id, package_spec: plan.target.package_spec,
      resolved_version: plan.target.resolved_version, artifact_digest: plan.target.artifact_digest, has_manifest: true as const };
    await expect(database.transaction(tx => runDeckPluginBindingOperation(
      "deck-agent-type.runtime-prepare", { ...scope, expected_binding_revision: 0,
        verified_plugin: { ...evidence, artifact_digest: `sha256:${"f".repeat(64)}` } }, principal("1"), tx, runtimePolicy)))
      .rejects.toMatchObject({ code: "RUNTIME_PLUGIN_NOT_READY", status: 409 });
    const prepared = deckAgentTypeRuntimePreparedDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-agent-type.runtime-prepare", { ...scope, expected_binding_revision: 0, verified_plugin: evidence }, principal("1"), tx, runtimePolicy)));
    expect(prepared).toMatchObject({ deck_id: runtimeDeckId, current_binding_revision: 0, runtime_ready: true });
    expect(deckAgentTypeRuntimePreparedDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-agent-type.runtime-prepare", { ...scope, expected_binding_revision: 0, verified_plugin: evidence }, principal("1"), tx, runtimePolicy))))
      .toEqual(prepared);
    const bound = deckPluginBindingResponseDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.save", { ...scope, deck_plugin_id: prepared.deck_plugin_id,
        deck_plugin_version: prepared.deck_plugin_version, apply_to: "next_run", expected_binding_revision: 0 }, principal("1"), tx)));
    expect(bound).toMatchObject({ deck_id: runtimeDeckId, binding_revision: 1, status: "active" });
    const materialized = await admin.query("SELECT cache_ref, materialization_status, activation_status, verification_status FROM runtime_plugin_materializations WHERE runtime_environment_id=$1", [runtimePolicy.runtime_environment_id]);
    expect(materialized.rows).toEqual([{ cache_ref: "/server-owned/binding-runtime", materialization_status: "materialized",
      activation_status: "loadable", verification_status: "verified" }]);
    const installed = await admin.query("SELECT status, default_version, installed_versions_json, approved_capabilities_json FROM deck_plugin_installations WHERE scope_id=$1", [runtimeWorkspaceId]);
    expect(installed.rows).toEqual([{ status: "ready", default_version: fixture.manifest.deck_plugin_version,
      installed_versions_json: JSON.stringify([fixture.manifest.deck_plugin_version]),
      approved_capabilities_json: JSON.stringify(fixture.manifest.capabilities) }]);
  });

  it("serializes concurrent compare-and-swap so only one revision commits", async () => {
    const command = { ...selection(concurrentDeckId), expected_binding_revision: 0 };
    const outcomes = await Promise.allSettled([
      database.transaction(tx => runDeckPluginBindingOperation("deck-plugin-binding.save", command, principal("1"), tx)),
      database.transaction(tx => runDeckPluginBindingOperation("deck-plugin-binding.save", command, principal("1"), tx)),
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(item => item.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "BINDING_REVISION_CONFLICT", status: 409,
      details: { current_revision: 1 } } });
    const evidence = await admin.query("SELECT binding_revision, status FROM deck_plugin_bindings WHERE deck_id=$1", [concurrentDeckId]);
    expect(evidence.rows).toEqual([{ binding_revision: 1, status: "active" }]);
  });

  it("fails closed for foreign ownership and stale expected revision", async () => {
    await expect(database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.current", { deck_id: "deck-binding-foreign", workspace_id: "workspace-binding-2" }, principal("1"), tx)))
      .rejects.toMatchObject({ code: "DECK_ACCESS_DENIED", status: 404 });
    await expect(database.transaction(tx => runDeckPluginBindingOperation(
      "deck-plugin-binding.save", { ...selection(), expected_binding_revision: 0 }, principal("1"), tx)))
      .rejects.toMatchObject({ code: "BINDING_REVISION_CONFLICT", status: 409, details: { current_revision: 1 } });
  });

  it("uses a role without user email or unrelated Admin table access", async () => {
    expect((await restrictedPool.query("SELECT current_user AS actor")).rows[0].actor)
      .toBe("ink_deck_plugin_binding_executor");
    await expect(restrictedPool.query("SELECT email FROM users LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
