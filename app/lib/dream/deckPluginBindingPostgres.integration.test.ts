// [Input] Named disposable PostgreSQL, restricted role and Registry122-126 DTO-Service-Drizzle path.
// [Output] Owner checks, compatibility projection, atomic CAS/history and least-privilege evidence.
// [Pos] Isolated destructive Deck Plugin binding contract test; never uses normal business data.
// [Sync] 2026-09-16: verify binding operations against Admin-migrated PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import {
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
const principal = (id: string) => ({ subject: `binding-subject-${id}`, canonical_user_id: id,
  client_id: "dream-browser", scopes: ["dream:read", "dream:write"], status: "active" });
const selection = (targetDeck = deckId) => ({ deck_id: targetDeck, workspace_id: workspaceId,
  deck_plugin_id: fixture.manifest.deck_plugin_id, deck_plugin_version: fixture.manifest.deck_plugin_version,
  apply_to: "next_run" as const });

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
        ('workspace-binding-2', 'Foreign Workspace', 2, '{}');
      INSERT INTO decks (id, name, owner_id, draft_revision) VALUES
        ('${deckId}', 'Binding Deck', 1, 1),
        ('${concurrentDeckId}', 'Binding Race Deck', 1, 1),
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
      fixture.manifest.deck_plugin_version, fixture.release.manifest_hash, JSON.stringify(fixture.lock)]);
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
