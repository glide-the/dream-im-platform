// [Input] Named PostgreSQL, restricted role and Registry120/121 confirmation/delegation services.
// [Output] Lifecycle, claim-bound grant recovery/fencing and least-privilege ACL evidence.
// [Pos] Isolated destructive contract test; disabled unless the dedicated harness supplies both URLs.
// [Sync] 2026-09-16: verify claim-turn grant recovery, lease fencing and ACK invalidation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  runStoryWorkspaceConfirmationBackgroundOperation,
  runStoryWorkspaceConfirmationOAuthOperation,
} from "./storyWorkspaceConfirmationService";
import { DelegationService } from "../auth/delegationService";

const adminUrl = process.env.STORY_WORKSPACE_CONFIRMATION_TEST_ADMIN_URL;
const restrictedUrl = process.env.STORY_WORKSPACE_CONFIRMATION_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const runId = `run_${"a".repeat(32)}`;
const concurrentRunId = `run_${"b".repeat(32)}`;
const foreignRunId = `run_${"c".repeat(32)}`;
const principal = (id: string) => ({ subject: `confirmation-subject-${id}`,
  canonical_user_id: id, client_id: "dream-browser",
  scopes: ["dream:read", "dream:write"], status: "active" as const });
const service = { id: "dream-service", oauthClientId: "dream-browser",
  backgroundScopes: ["story-confirmation:dispatch"] };
const command = (id = runId, threadId = "thread-confirmation-1", key = "swc_pg-1") => ({
  storyWorkspaceRunId: id,
  threadId,
  baseRevisions: { characters: 2, scenes: 3, storyboards: 4 },
  edits: [{ stage: "characters", entityId: "character-1",
    fields: { displayName: "主角", summary: null, relations: ["scene-1"] } }],
  idempotencyKey: key,
});

describe.skipIf(!enabled)("Story Workspace confirmation PostgreSQL contract", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const restrictedPool = new pg.Pool({ connectionString: restrictedUrl, max: 8 });
  const database = drizzle(restrictedPool);

  beforeAll(async () => {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    expect(String(identity.rows[0].database)).toMatch(/^ink_story_workspace_confirmation_test_[a-z0-9_]+$/);
    expect(String(identity.rows[0].actor)).toBe("postgres");
    const capability = await admin.query(`SELECT version, contract_sha256
      FROM drizzle.schema_capabilities WHERE capability='identity.runtime-confirmation-claim.v1'`);
    expect(capability.rows).toEqual([{ version: 1,
      contract_sha256: "d9de67655e6d8d5ae9654d6502a2cf5d9ab1bb6d829975b243eb25e239b08919" }]);
    await admin.query(`
      INSERT INTO users (id, email, password_hash) VALUES
        (1, 'confirmation-one@example.invalid', 'fixture'),
        (2, 'confirmation-two@example.invalid', 'fixture');
      INSERT INTO platform_users (id, source, external_user_id, email, status)
      VALUES
        ('platform-confirmation-1', 'ink-dream', '1', 'confirmation-one@example.invalid', 'active'),
        ('platform-confirmation-2', 'ink-dream', '2', 'confirmation-two@example.invalid', 'active')
      ON CONFLICT (source, external_user_id) DO NOTHING;
      INSERT INTO identity."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      VALUES
        ('confirmation-subject-1', 'Writer One', 'confirmation-auth-one@example.invalid', true, now(), now()),
        ('confirmation-subject-2', 'Writer Two', 'confirmation-auth-two@example.invalid', true, now(), now());
      INSERT INTO identity.subject_links (auth_user_id, canonical_user_id, evidence)
      VALUES
        ('confirmation-subject-1', 1, 'fixture'),
        ('confirmation-subject-2', 2, 'fixture');
      INSERT INTO story_workspace_workspaces (id, name, owner_id, settings) VALUES
        ('workspace-1', 'Writer One', 1, '{}'),
        ('workspace-2', 'Writer Two', 2, '{}');
      INSERT INTO chat_thread (id, user_id, title) VALUES
        ('thread-confirmation-1', 1, 'Confirmation Thread'),
        ('thread-confirmation-concurrent', 1, 'Concurrent Confirmation'),
        ('thread-confirmation-foreign', 2, 'Foreign Confirmation');
      INSERT INTO decks (id, name, owner_id) VALUES
        ('deck-1', 'Deck One', 1), ('deck-2', 'Deck Two', 1), ('deck-3', 'Deck Three', 2);
      INSERT INTO deck_plugin_releases
        (id, deck_plugin_id, deck_plugin_version, display_name, status, manifest_json,
         manifest_hash, workflow_definition_ref)
      VALUES
        ('release-1', 'story-plugin-1', '1.0.0', 'Story One', 'published', '{}',
         'sha256:${"1".repeat(64)}', 'workflow://story'),
        ('release-2', 'story-plugin-2', '1.0.0', 'Story Two', 'published', '{}',
         'sha256:${"4".repeat(64)}', 'workflow://story'),
        ('release-3', 'story-plugin-3', '1.0.0', 'Story Three', 'published', '{}',
         'sha256:${"7".repeat(64)}', 'workflow://story');
      INSERT INTO deck_runtime_plugin_locks
        (id, deck_plugin_id, deck_plugin_version, deck_plugin_manifest_hash, lock_json)
      VALUES
        ('lock-1', 'story-plugin-1', '1.0.0', 'sha256:${"1".repeat(64)}', '{}'),
        ('lock-2', 'story-plugin-2', '1.0.0', 'sha256:${"4".repeat(64)}', '{}'),
        ('lock-3', 'story-plugin-3', '1.0.0', 'sha256:${"7".repeat(64)}', '{}');
      INSERT INTO deck_plugin_bindings
        (deck_plugin_binding_id, deck_id, workspace_id, creator_id, deck_plugin_id,
         deck_plugin_version, binding_revision, status, applied_to)
      VALUES
        ('binding-1', 'deck-1', 'workspace-1', '1', 'story-plugin-1', '1.0.0', 1, 'active', 'next_run'),
        ('binding-2', 'deck-2', 'workspace-1', '1', 'story-plugin-2', '1.0.0', 1, 'active', 'next_run'),
        ('binding-3', 'deck-3', 'workspace-2', '2', 'story-plugin-3', '1.0.0', 1, 'active', 'next_run');
      INSERT INTO workflow_preflights
        (workflow_preflight_id, request_fingerprint, deck_id, binding_revision,
         deck_plugin_id, deck_plugin_version, runtime_plugin_lock_id,
         deck_runtime_profile_id, input_hash, status, expires_at, created_by)
      VALUES
        ('pf_${"1".repeat(32)}', 'preflight-1', 'deck-1', 1, 'story-plugin-1', '1.0.0',
         'lock-1', 'profile-1', 'sha256:${"2".repeat(64)}', 'passed', now() + interval '1 day', '1'),
        ('pf_${"2".repeat(32)}', 'preflight-2', 'deck-2', 1, 'story-plugin-2', '1.0.0',
         'lock-2', 'profile-2', 'sha256:${"5".repeat(64)}', 'passed', now() + interval '1 day', '1'),
        ('pf_${"3".repeat(32)}', 'preflight-3', 'deck-3', 1, 'story-plugin-3', '1.0.0',
         'lock-3', 'profile-3', 'sha256:${"8".repeat(64)}', 'passed', now() + interval '1 day', '2');
      ALTER TABLE workflow_runs DISABLE TRIGGER ALL;
      INSERT INTO workflow_runs
        (id, workspace_id, deck_plugin_id, deck_plugin_version, workflow_definition_ref,
         deck_runtime_snapshot_id, status, deck_plugin_manifest_hash, deck_plugin_binding_id,
         binding_revision, runtime_plugin_lock_id, runtime_load_receipt_id, workflow_preflight_id,
         agent_session_id, source_voice_thread_id, idempotency_key, input_hash,
         semantic_fingerprint, status_version, created_by, started_at)
      VALUES
        ('${runId}', 'workspace-1', 'story-plugin-1', '1.0.0', 'workflow://story', 'snapshot-1',
         'running', 'sha256:${"1".repeat(64)}', 'binding-1', 1, 'lock-1', 'receipt-1',
         'pf_${"1".repeat(32)}', 'as_${"1".repeat(32)}', 'thread-confirmation-1', 'run-key-1',
         'sha256:${"2".repeat(64)}', 'sha256:${"3".repeat(64)}', 2, '1', now()),
        ('${concurrentRunId}', 'workspace-1', 'story-plugin-2', '1.0.0', 'workflow://story', 'snapshot-2',
         'running', 'sha256:${"4".repeat(64)}', 'binding-2', 1, 'lock-2', 'receipt-2',
         'pf_${"2".repeat(32)}', 'as_${"2".repeat(32)}', 'thread-confirmation-concurrent', 'run-key-2',
         'sha256:${"5".repeat(64)}', 'sha256:${"6".repeat(64)}', 2, '1', now()),
        ('${foreignRunId}', 'workspace-2', 'story-plugin-3', '1.0.0', 'workflow://story', 'snapshot-3',
         'running', 'sha256:${"7".repeat(64)}', 'binding-3', 1, 'lock-3', 'receipt-3',
         'pf_${"3".repeat(32)}', 'as_${"3".repeat(32)}', 'thread-confirmation-foreign', 'run-key-3',
         'sha256:${"8".repeat(64)}', 'sha256:${"9".repeat(64)}', 2, '2', now());
      ALTER TABLE workflow_runs ENABLE TRIGGER ALL;
      ALTER TABLE workflow_run_transitions DISABLE TRIGGER ALL;
      INSERT INTO workflow_run_transitions
        (id, workflow_run_id, transition_seq, from_status, to_status, actor_id, reason_code, occurred_at)
      VALUES
        ('wrt_${"1".repeat(32)}', '${runId}', 1, NULL, 'preflight', '1', 'created', now()),
        ('wrt_${"2".repeat(32)}', '${runId}', 2, 'queued', 'running', '1', 'started', now()),
        ('wrt_${"3".repeat(32)}', '${concurrentRunId}', 1, NULL, 'preflight', '1', 'created', now()),
        ('wrt_${"4".repeat(32)}', '${concurrentRunId}', 2, 'queued', 'running', '1', 'started', now()),
        ('wrt_${"5".repeat(32)}', '${foreignRunId}', 1, NULL, 'preflight', '2', 'created', now()),
        ('wrt_${"6".repeat(32)}', '${foreignRunId}', 2, 'queued', 'running', '2', 'started', now());
      ALTER TABLE workflow_run_transitions ENABLE TRIGGER ALL;
    `);
  });

  afterAll(async () => { await restrictedPool.end(); await admin.end(); });

  it("commits the message and three Run transitions in one transaction", async () => {
    const result = await database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
      "story-workspace-confirmation.submit", { command_json: JSON.stringify(command()) },
      principal("1"), service.id, "confirmation-submit", tx));
    expect(result).toMatchObject({ status: "accepted", replayed: false, dispatched: false,
      story_workspace_run_id: runId, thread_id: "thread-confirmation-1" });
    expect(result.dispatch).not.toBeNull();
    const evidence = await admin.query(`SELECT
      (SELECT status FROM workflow_runs WHERE id=$1) AS status,
      (SELECT status_version FROM workflow_runs WHERE id=$1) AS status_version,
      (SELECT count(*)::int FROM workflow_run_transitions WHERE workflow_run_id=$1) AS transitions,
      (SELECT count(*)::int FROM chat_message WHERE id=$2) AS messages,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='confirmation-submit') AS receipts`,
    [runId, result.message_id]);
    expect(evidence.rows[0]).toEqual({ status: "confirmed", status_version: 5,
      transitions: 5, messages: 1, receipts: 1 });
  });

  it("claims one turn grant, recovers it and fences lease/ACK before ORM access", async () => {
    const factBefore = await database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
      "story-workspace-confirmation.fact", { workflow_run_id: runId }, principal("1"),
      service.id, "confirmation-fact-before", tx));
    expect(factBefore).toMatchObject({ confirmation_accepted: true, confirmation_dispatched: false });
    const message = (await admin.query("SELECT id FROM chat_message WHERE thread_id='thread-confirmation-1'")).rows[0].id;
    const claim = await database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.claim-turn", { message_id: message, claim_id: "claim-pg-1" }, service, tx));
    expect(claim.dispatch).toMatchObject({ message_id: message, actor_id: "1" });
    expect(claim.authority).toMatchObject({ purpose: "server-persistence",
      thread_id: "thread-confirmation-1", run_id: runId,
      scopes: ["dream:read", "dream:write"] });
    const recovered = await database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.claim-turn", { message_id: message, claim_id: "claim-pg-1" }, service, tx));
    expect(recovered.authority?.token).toBe(claim.authority?.token);
    await expect(database.transaction(tx => new DelegationService(tx).resolve(
      claim.authority!.token, "dream:read", service.id, "thread-confirmation-1", runId, null,
    ))).resolves.toMatchObject({ principal: { canonical_user_id: "1" },
      purpose: "server-persistence", threadId: "thread-confirmation-1", runId });
    const expired = await database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.lease",
      { message_id: message, claim_id: "claim-pg-1", duration_seconds: 0 }, service, tx));
    expect(expired.renewed).toBe(true);
    await expect(database.transaction(tx => new DelegationService(tx).resolve(
      claim.authority!.token, "dream:read", service.id,
    ))).rejects.toMatchObject({ code: "DELEGATION_REQUIRED", status: 401 });
    const replacement = await database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.claim-turn",
      { message_id: message, claim_id: "claim-pg-2" }, service, tx));
    expect(replacement.authority?.token).not.toBe(claim.authority?.token);
    await expect(database.transaction(tx => new DelegationService(tx).resolve(
      claim.authority!.token, "dream:read", service.id,
    ))).rejects.toMatchObject({ code: "DELEGATION_REQUIRED", status: 401 });
    await expect(database.transaction(tx => new DelegationService(tx).resolve(
      replacement.authority!.token, "dream:read", service.id,
    ))).resolves.toMatchObject({ principal: { canonical_user_id: "1" } });
    const staleLease = await database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.lease",
      { message_id: message, claim_id: "claim-pg-1", duration_seconds: null }, service, tx));
    expect(staleLease.renewed).toBe(false);
    await expect(database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
      "story-workspace-confirmation.ack", { message_id: message, claim_id: "claim-pg-2" }, service, tx)))
      .resolves.toEqual({ acked: true });
    await expect(database.transaction(tx => new DelegationService(tx).resolve(
      replacement.authority!.token, "dream:write", service.id,
    ))).rejects.toMatchObject({ code: "DELEGATION_REQUIRED", status: 401 });
    const factAfter = await database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
      "story-workspace-confirmation.fact", { workflow_run_id: runId }, principal("1"),
      service.id, "confirmation-fact-after", tx));
    expect(factAfter).toMatchObject({ confirmation_accepted: true, confirmation_dispatched: true });
    const replay = await database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
      "story-workspace-confirmation.submit", { command_json: JSON.stringify(command()) },
      principal("1"), service.id, "confirmation-replay", tx));
    expect(replay).toMatchObject({ replayed: true, dispatched: true, dispatch: null });
  });

  it("serializes concurrent business-identical submissions and denies foreign Runs", async () => {
    const concurrentCommand = command(concurrentRunId, "thread-confirmation-concurrent", "swc_pg-race");
    const [left, right] = await Promise.all([
      database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
        "story-workspace-confirmation.submit", { command_json: JSON.stringify(concurrentCommand) },
        principal("1"), service.id, "confirmation-race-a", tx)),
      database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
        "story-workspace-confirmation.submit", { command_json: JSON.stringify(concurrentCommand) },
        principal("1"), service.id, "confirmation-race-b", tx)),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect([left.dispatch, right.dispatch].filter(Boolean)).toHaveLength(1);
    const message = (await admin.query(
      "SELECT id FROM chat_message WHERE thread_id='thread-confirmation-concurrent'",
    )).rows[0].id;
    const [claimLeft, claimRight] = await Promise.all([
      database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
        "story-workspace-confirmation.claim-turn",
        { message_id: message, claim_id: "claim-pg-concurrent" }, service, tx)),
      database.transaction(tx => runStoryWorkspaceConfirmationBackgroundOperation(
        "story-workspace-confirmation.claim-turn",
        { message_id: message, claim_id: "claim-pg-concurrent" }, service, tx)),
    ]);
    expect(claimLeft.authority?.token).toBe(claimRight.authority?.token);
    const grantCount = await admin.query(`SELECT count(*)::int AS count
      FROM identity.runtime_delegations
      WHERE service_client_id=$1 AND source_message_id=$2 AND source_claim_id=$3`,
    [service.id, message, "claim-pg-concurrent"]);
    expect(grantCount.rows[0].count).toBe(1);
    await expect(database.transaction(tx => runStoryWorkspaceConfirmationOAuthOperation(
      "story-workspace-confirmation.submit",
      { command_json: JSON.stringify(command(foreignRunId, "thread-confirmation-foreign", "swc_pg-foreign")) },
      principal("1"), service.id, "confirmation-foreign", tx)))
      .rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
  });

  it("uses a restricted role without direct user-secret access", async () => {
    expect((await restrictedPool.query("SELECT current_user AS actor")).rows[0].actor)
      .toBe("ink_story_confirmation_executor");
    await expect(restrictedPool.query("SELECT email, password_hash FROM users LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
