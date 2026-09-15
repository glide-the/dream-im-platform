// [Input] Named disposable PostgreSQL, restricted role and Registry122-133 DTO-Service-Drizzle path.
// [Output] Binding CAS, current/frozen Runtime and actor-derived replay lookup evidence.
// [Pos] Isolated destructive technical contract; never uses normal business data.
// [Sync] 2026-09-16: verify Registry133 source/Run replay through the restricted Admin executor.
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
  dreamLaunchRuntimePlanDto,
  dreamLaunchRuntimePreparedDto,
  dreamLaunchRuntimeScopeDto,
} from "./deckPluginBindingDto";
import { runDeckPluginBindingOperation } from "./deckPluginBindingService";
import { lookupDreamLaunchReplay } from "./dreamLaunchSourceService";
import { dreamLaunchSourceEnvelope, dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { canonicalBusinessJson } from "./deckContentCanonical";

const adminUrl = process.env.DECK_PLUGIN_BINDING_TEST_ADMIN_URL;
const restrictedUrl = process.env.DECK_PLUGIN_BINDING_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const fixture = compatibilityFixture();
const deckId = "deck-binding-1";
const concurrentDeckId = "deck-binding-race";
const workspaceId = "workspace-binding-1";
const runtimeDeckId = "deck-binding-runtime";
const runtimeWorkspaceId = "workspace-binding-runtime";
const launchDeckId = "deck-binding-launch";
const launchWorkspaceId = "workspace-binding-launch";
const launchBindingId = `dpb_${"7".repeat(32)}`;
const launchRunId = `run_${"7".repeat(32)}`;
const replayInput = { workspace_id: launchWorkspaceId, deck_id: launchDeckId, agent_id: null,
  goal: "Registry133 回放", idempotency_key: "binding-launch-key" };
let replayIdentity: Awaited<ReturnType<typeof dreamLaunchSourceIdentity>>;
const principal = (id: string) => ({ subject: `binding-subject-${id}`, canonical_user_id: id,
  client_id: "dream-browser", scopes: ["dream:read", "dream:write"], status: "active" as const });
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
    replayIdentity = await dreamLaunchSourceIdentity("1", replayInput);
    const source = dreamLaunchSourceEnvelope("1", replayInput, replayIdentity.requestFingerprint);
    const goalHash = (await canonicalBusinessJson(JSON.stringify({ goal: replayInput.goal }))).content_hash;
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
        ('${launchWorkspaceId}', 'Launch Workspace', 1, '{}'),
        ('workspace-binding-2', 'Foreign Workspace', 2, '{}');
      INSERT INTO decks (id, name, owner_id, draft_revision) VALUES
        ('${deckId}', 'Binding Deck', 1, 1),
        ('${concurrentDeckId}', 'Binding Race Deck', 1, 1),
        ('${runtimeDeckId}', 'Binding Runtime Deck', 1, 1),
        ('${launchDeckId}', 'Binding Launch Deck', 1, 1),
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
    await admin.query(`INSERT INTO deck_plugin_bindings
      (deck_plugin_binding_id, deck_id, workspace_id, creator_id, deck_plugin_id,
       deck_plugin_version, binding_revision, status, applied_to)
      VALUES ($1,$2,$3,'1',$4,$5,1,'active','next_run')`, [
      launchBindingId, launchDeckId, launchWorkspaceId, fixture.manifest.deck_plugin_id,
      fixture.manifest.deck_plugin_version,
    ]);
    await admin.query(`INSERT INTO workflow_preflights
      (workflow_preflight_id, request_fingerprint, deck_id, binding_revision,
       deck_plugin_id, deck_plugin_version, runtime_plugin_lock_id,
       deck_runtime_profile_id, input_hash, status, expires_at, created_by)
      VALUES ($1,'binding-launch-preflight',$2,1,$3,$4,$5,'binding-launch-profile',$6,
       'passed',now() + interval '1 day','1')`, [
      `pf_${"7".repeat(32)}`, launchDeckId, fixture.manifest.deck_plugin_id,
      fixture.manifest.deck_plugin_version, fixture.lock.runtime_plugin_lock_id,
      `sha256:${"7".repeat(64)}`,
    ]);
    await admin.query("ALTER TABLE workflow_runs DISABLE TRIGGER ALL");
    await admin.query(`INSERT INTO chat_thread (id, user_id, title, deck_id) VALUES ($1,1,'Registry133',$2)`,
      [replayIdentity.threadId, launchDeckId]);
    await admin.query(`INSERT INTO chat_message (id, thread_id, role, parts, metadata, created_at)
      VALUES ($1,$2,'user',$3,$4,'2026-09-16T01:02:03.123456+00:00')`,
      [replayIdentity.messageId, replayIdentity.threadId, source.parts, source.metadata]);
    await admin.query(`INSERT INTO workflow_runs
      (id, workspace_id, deck_plugin_id, deck_plugin_version, workflow_definition_ref,
       deck_runtime_snapshot_id, status, deck_plugin_manifest_hash, deck_plugin_binding_id,
       binding_revision, runtime_plugin_lock_id, workflow_preflight_id, source_voice_thread_id,
       source_message_id, source_message_time, idempotency_key, input_hash, semantic_fingerprint, created_by)
      VALUES ($1,$2,$3,$4,$5,'binding-launch-snapshot','queued',$6,$7,1,$8,$9,$10,$11,
       '2026-09-16T01:02:03.123456+00:00','binding-launch-key',$12,$13,'1')`, [
      launchRunId, launchWorkspaceId, fixture.manifest.deck_plugin_id,
      fixture.manifest.deck_plugin_version, fixture.release.workflow_definition_ref,
      fixture.release.manifest_hash, launchBindingId, fixture.lock.runtime_plugin_lock_id,
      `pf_${"7".repeat(32)}`, replayIdentity.threadId, replayIdentity.messageId, goalHash,
      `sha256:${"9".repeat(64)}`,
    ]);
    await admin.query("ALTER TABLE workflow_runs ENABLE TRIGGER ALL");
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

  it("authorizes and prepares current launch then derives frozen replay from the Run", async () => {
    const scope = { deck_id: launchDeckId, workspace_id: launchWorkspaceId, agent_id: null };
    expect(dreamLaunchRuntimeScopeDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "dream-launch.runtime-scope", scope, principal("1"), tx, runtimePolicy))))
      .toEqual({ ...scope, authorized: true });
    const currentInput = { ...scope, mode: "current" as const, workflow_run_id: null, thread_id: null };
    const current = dreamLaunchRuntimePlanDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "dream-launch.runtime-plan", currentInput, principal("1"), tx, runtimePolicy)));
    expect(current).toMatchObject({ mode: "current", binding: { deck_plugin_binding_id: launchBindingId,
      binding_revision: 1 }, target: { runtime_plugin_lock_id: fixture.lock.runtime_plugin_lock_id } });
    expect(current.target).not.toHaveProperty("artifact_path");
    const evidence = { plugin_installation_id: current.target.plugin_installation_id,
      package_spec: current.target.package_spec, resolved_version: current.target.resolved_version,
      artifact_digest: current.target.artifact_digest, has_manifest: true as const };
    expect(dreamLaunchRuntimePreparedDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "dream-launch.runtime-prepare", { ...currentInput, expected_binding_revision: 1, verified_plugin: evidence },
      principal("1"), tx, runtimePolicy)))).toMatchObject({ mode: "current", runtime_ready: true });

    await admin.query("UPDATE deck_plugin_bindings SET status='stale' WHERE deck_plugin_binding_id=$1", [launchBindingId]);
    await admin.query(`INSERT INTO deck_plugin_bindings
      (deck_plugin_binding_id, deck_id, workspace_id, creator_id, deck_plugin_id,
       deck_plugin_version, binding_revision, status, applied_to)
      VALUES ($1,$2,$3,'1',$4,$5,2,'active','next_run')`, [
      `dpb_${"8".repeat(32)}`, launchDeckId, launchWorkspaceId, fixture.manifest.deck_plugin_id,
      fixture.manifest.deck_plugin_version,
    ]);
    const replayInput = { ...scope, mode: "replay" as const, workflow_run_id: launchRunId,
      thread_id: replayIdentity.threadId };
    const replay = dreamLaunchRuntimePlanDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "dream-launch.runtime-plan", replayInput, principal("1"), tx, runtimePolicy)));
    expect(replay).toMatchObject({ mode: "replay", binding: { deck_plugin_binding_id: launchBindingId,
      binding_revision: 1 }, target: { runtime_plugin_lock_id: fixture.lock.runtime_plugin_lock_id } });
    expect(dreamLaunchRuntimePreparedDto.parse(await database.transaction(tx => runDeckPluginBindingOperation(
      "dream-launch.runtime-prepare", { ...replayInput, expected_binding_revision: 1, verified_plugin: evidence },
      principal("1"), tx, runtimePolicy)))).toMatchObject({ mode: "replay", binding: {
        deck_plugin_binding_id: launchBindingId, binding_revision: 1 }, runtime_ready: true });
  });

  it("reads Registry133 replay through strict DTO, Service and restricted Drizzle repository", async () => {
    const actor = { principal: principal("1"), threadScope: null, runScope: null };
    expect(await database.transaction(tx => lookupDreamLaunchReplay(replayInput, actor, tx))).toEqual({ replay: {
      workflow_run_id: launchRunId, workflow_preflight_id: `pf_${"7".repeat(32)}`,
      thread_id: replayIdentity.threadId, message_id: replayIdentity.messageId,
    } });
    expect(await database.transaction(tx => lookupDreamLaunchReplay(
      { ...replayInput, idempotency_key: "missing-key" }, actor, tx))).toEqual({ replay: null });
    await expect(database.transaction(tx => lookupDreamLaunchReplay(
      { ...replayInput, goal: "changed" }, actor, tx)))
      .rejects.toMatchObject({ code: "DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", status: 409 });
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
