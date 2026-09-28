// [Input] Explicitly owned, migrated isolated PostgreSQL and the production scheduled Chat domain services.
// [Output] Claim, pre-model recovery, exact turn completion, inactive manual skip and nullable history evidence.
// [Pos] Provider-free service integration contract; a runner owns database creation, migration and cleanup.
// [Sync] 2026-09-28: prove prepared TaskSession reuse and accept the existing users-to-platform fixture trigger.
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { runChatThreadOperation, type ChatThreadActor } from "./chatThreadService";
import { runChatScheduledBackgroundOperation, runChatScheduledUserOperation } from "./chatScheduledTaskService";
import { resolveScheduledChatAuthority } from "./chatScheduledTaskAuthority";
import { claimScheduledTriggerResultDto, prepareScheduledTriggerResultDto,
  reconcileScheduledTriggerResultDto, scheduledTaskResultDto, scheduledTriggerResultDto,
  startScheduledTriggerResultDto, finishScheduledTriggerResultDto } from "./chatScheduledTaskDto";

const databaseUrl = process.env.SCHEDULED_CHAT_TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "";
const enabled = process.env.SCHEDULED_CHAT_TEST_OWNED === "1"
  && /^ink_scheduled_chat_test_[a-z0-9_]+$/.test(databaseName);

describe.skipIf(!enabled)("scheduled Chat isolated PostgreSQL contract", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const database = drizzle(pool);
  const service = { id: "scheduled-chat-fixture", backgroundScopes: ["schedule:execute"] as const };
  const actor: ChatThreadActor = { principal: { subject: "scheduled-subject-1", canonical_user_id: "1",
    client_id: "scheduled-fixture-client", scopes: ["dream:read", "dream:write"], status: "active" },
    threadScope: null };
  const chat = (operation: Parameters<typeof runChatThreadOperation>[0], input: unknown) =>
    database.transaction(tx => runChatThreadOperation(operation, input, actor, tx));
  const user = (operation: Parameters<typeof runChatScheduledUserOperation>[0], input: unknown) =>
    database.transaction(tx => runChatScheduledUserOperation(operation, input, actor, tx, service.id));
  const worker = (operation: Parameters<typeof runChatScheduledBackgroundOperation>[0], input: unknown) =>
    database.transaction(tx => runChatScheduledBackgroundOperation(operation, input, service, tx));

  beforeAll(async () => {
    const identity = await pool.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== databaseName) throw new Error("SCHEDULED_TEST_DATABASE_IDENTITY_MISMATCH");
    const existing = await pool.query("SELECT count(*)::int AS count FROM users");
    if (existing.rows[0]?.count !== 0) throw new Error("SCHEDULED_TEST_DATABASE_NOT_EMPTY");
    const capabilities = await pool.query(`SELECT capability FROM drizzle.schema_capabilities
      WHERE capability IN ('dream.chat-scheduled-task.v1', 'identity.scheduled-chat-runtime.v1',
        'dream.chat-scheduled-turn-binding.v1', 'dream.chat-scheduled-link-lifecycle.v1')`);
    expect(capabilities.rows).toHaveLength(4);
    process.env.AUTH_CHAT_SCHEDULE_AUTHORITY_SECRET = randomBytes(48).toString("base64url");
    await pool.query(`
      INSERT INTO users (id, email, password_hash)
        VALUES (1, 'scheduled-one@example.invalid', 'fixture');
      INSERT INTO platform_users (id, source, external_user_id, email, status)
        VALUES ('platform-scheduled-1', 'ink-dream', '1', 'scheduled-one@example.invalid', 'active')
        ON CONFLICT (source, external_user_id) DO NOTHING;
      INSERT INTO identity."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES ('scheduled-subject-1', 'Scheduled Fixture', 'scheduled-auth@example.invalid', true, now(), now());
      INSERT INTO identity.subject_links (auth_user_id, canonical_user_id, evidence)
        VALUES ('scheduled-subject-1', 1, 'fixture');
    `);
    const platform = await pool.query(`SELECT status FROM platform_users
      WHERE source='ink-dream' AND external_user_id='1'`);
    expect(platform.rows).toEqual([{ status: "active" }]);
  });
  afterAll(async () => { await pool.end(); });

  it("fences claims, reuses prepared input before start and keeps history after target deletion", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null, title: "Scheduled source" })) as { thread_id: string };
    const futureDate = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    const create = { source_thread_id: source.thread_id, create_request_key: "scheduled-create-1",
      title: "Scheduled task", prompt: "Write one response",
      rule: { kind: "once" as const, local_date: futureDate, local_time: "12:00",
        time_zone: "UTC", selected_offset_minutes: 0 } };
    const first = scheduledTaskResultDto.parse(await user("scheduled-task.create", create)).task;
    const replay = scheduledTaskResultDto.parse(await user("scheduled-task.create", create)).task;
    expect(replay.id).toBe(first.id);
    await expect(user("scheduled-task.create", { ...create, prompt: "Changed prompt" }))
      .rejects.toMatchObject({ code: "SCHEDULE_CREATE_IDENTITY_CONFLICT" });
    await expect(user("scheduled-task.pause", { task_id: first.id, expected_revision: first.revision + 1 }))
      .rejects.toMatchObject({ code: "SCHEDULE_REVISION_CONFLICT" });

    const pending = scheduledTriggerResultDto.parse(await user("scheduled-task.run", {
      task_id: first.id, manual_request_key: "manual-before-pause",
    })).trigger;
    const paused = scheduledTaskResultDto.parse(await user("scheduled-task.pause", {
      task_id: first.id, expected_revision: first.revision,
    })).task;
    expect(paused.status).toBe("paused");
    expect(claimScheduledTriggerResultDto.parse(await worker("scheduled-trigger.claim", {})).trigger).toBeNull();
    const skipped = (await pool.query("SELECT status, error_code FROM chat_scheduled_trigger WHERE id=$1", [pending.id])).rows[0];
    expect(skipped).toEqual({ status: "skipped", error_code: "SCHEDULE_INACTIVE_BEFORE_CLAIM" });

    const resumed = scheduledTaskResultDto.parse(await user("scheduled-task.resume", {
      task_id: first.id, expected_revision: paused.revision,
    })).task;
    expect(resumed.status).toBe("active");
    const manual = scheduledTriggerResultDto.parse(await user("scheduled-task.run", {
      task_id: first.id, manual_request_key: "manual-ready",
    })).trigger;
    const claims = await Promise.all([
      worker("scheduled-trigger.claim", {}), worker("scheduled-trigger.claim", {}),
    ]);
    const won = claims.map(value => claimScheduledTriggerResultDto.parse(value)).filter(value => value.claim_id !== null);
    expect(won).toHaveLength(1);
    const claimId = won[0].claim_id!;
    expect(won[0].trigger?.id).toBe(manual.id);
    const prepared = prepareScheduledTriggerResultDto.parse(await worker("scheduled-trigger.prepare", {
      trigger_id: manual.id, claim_id: claimId,
    }));
    if (!prepared.prepared) throw new Error(`SCHEDULE_PREPARE_FAILED:${prepared.error_code}`);
    expect(prepared.trigger.target_turn_id).toBeNull();
    const previousTarget = prepared.trigger.target_thread_id;
    const previousInput = prepared.trigger.input_message_id;
    if (!previousTarget || !previousInput) throw new Error("SCHEDULE_PREPARE_LINKS_MISSING");
    await expect(database.transaction(tx => resolveScheduledChatAuthority(tx,
      prepared.authority_token, "chat-message.persist", "another-service")))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_REQUIRED" });
    await database.transaction(tx => resolveScheduledChatAuthority(tx,
      prepared.authority_token, "chat-message.persist", service.id));

    // Fault injection is confined to this named disposable database. No model turn was bound.
    await pool.query("UPDATE chat_scheduled_trigger SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [manual.id]);
    const retryable = reconcileScheduledTriggerResultDto.parse(await worker("scheduled-trigger.reconcile", {
      trigger_id: manual.id,
    })).trigger;
    expect(retryable).toMatchObject({ status: "claimed", claim_id: null,
      target_thread_id: previousTarget, input_message_id: previousInput, target_turn_id: null });
    await expect(database.transaction(tx => resolveScheduledChatAuthority(tx,
      prepared.authority_token, "chat-message.persist", service.id)))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });
    const reclaimed = claimScheduledTriggerResultDto.parse(await worker("scheduled-trigger.claim", {}));
    expect(reclaimed.trigger?.id).toBe(manual.id);
    expect(reclaimed.claim_id).not.toBe(claimId);
    if (!reclaimed.claim_id) throw new Error("SCHEDULE_RECLAIM_MISSING");
    const preparedAgain = prepareScheduledTriggerResultDto.parse(await worker("scheduled-trigger.prepare", {
      trigger_id: manual.id, claim_id: reclaimed.claim_id,
    }));
    if (!preparedAgain.prepared) throw new Error(`SCHEDULE_REPREPARE_FAILED:${preparedAgain.error_code}`);
    expect(preparedAgain.trigger.target_thread_id).toBe(previousTarget);
    expect(preparedAgain.trigger.input_message_id).toBe(previousInput);
    const started = startScheduledTriggerResultDto.parse(await worker("scheduled-trigger.start", {
      trigger_id: manual.id, claim_id: reclaimed.claim_id, target_turn_id: "scheduled-target-turn",
    })).trigger;
    expect(started).toMatchObject({ status: "running", target_turn_id: "scheduled-target-turn" });
    await expect(worker("scheduled-trigger.start", { trigger_id: manual.id,
      claim_id: claimId, target_turn_id: "scheduled-target-turn" }))
      .rejects.toMatchObject({ code: "SCHEDULE_CLAIM_INVALID" });

    await chat("chat-message.persist", { thread_id: previousTarget, message_id: "scheduled-wrong-final",
      role: "assistant", parts: [{ type: "text", text: "Wrong turn" }],
      metadata: { turnId: "another-turn", turnStatus: "completed", finalPartIndex: 0 },
      history_final_text: "Wrong turn", history_process_available: false, history_projection_version: 1 });
    await expect(worker("scheduled-trigger.finish", { trigger_id: manual.id, claim_id: reclaimed.claim_id,
      status: "succeeded", final_message_id: "scheduled-wrong-final", error_code: null }))
      .rejects.toMatchObject({ code: "SCHEDULE_FINAL_INVALID" });
    await chat("chat-message.persist", { thread_id: previousTarget, message_id: "scheduled-good-final",
      role: "assistant", parts: [{ type: "text", text: "Verified response" }],
      metadata: { turnId: "scheduled-target-turn", turnStatus: "completed", finalPartIndex: 0 },
      history_final_text: "Verified response", history_process_available: false, history_projection_version: 1 });
    const completed = finishScheduledTriggerResultDto.parse(await worker("scheduled-trigger.finish", {
      trigger_id: manual.id, claim_id: reclaimed.claim_id, status: "succeeded",
      final_message_id: "scheduled-good-final", error_code: null,
    })).trigger;
    expect(completed).toMatchObject({ status: "succeeded", final_message_id: "scheduled-good-final" });
    await expect(database.transaction(tx => resolveScheduledChatAuthority(tx,
      preparedAgain.authority_token, "chat-message.persist", service.id)))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });

    await chat("chat-thread.delete", { thread_id: previousTarget });
    const history = (await pool.query(`SELECT status, task_session_id, target_thread_id,
      input_message_id, final_message_id, target_turn_id FROM chat_scheduled_trigger WHERE id=$1`, [manual.id])).rows[0];
    expect(history).toEqual({ status: "succeeded", task_session_id: null, target_thread_id: null,
      input_message_id: null, final_message_id: null, target_turn_id: "scheduled-target-turn" });
  });
});
