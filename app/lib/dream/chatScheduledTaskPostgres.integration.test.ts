// [Input] Explicitly owned, migrated isolated PostgreSQL and production v1/v2/v3 scheduled Chat services.
// [Output] Recurrence, source/new Thread dispatch, model snapshots, concurrency, recovery and compatibility evidence.
// [Pos] Provider-free service integration contract; a runner owns database creation, migration and cleanup.
// [Sync] 2026-10-07: cover v3 recurrence, immutable model selection and source/new Thread execution semantics.
// [Sync] 2026-10-07: resolve real signed v3 prepare authority for both Thread modes before model dispatch.
import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { runChatThreadOperation, type ChatThreadActor } from "./chatThreadService";
import { runChatScheduledBackgroundOperation, runChatScheduledBackgroundV2Operation, runChatScheduledBackgroundV3Operation,
  runChatScheduledUserOperation, runChatScheduledUserV2Operation, runChatScheduledUserV3Operation } from "./chatScheduledTaskService";
import { resolveScheduledChatAuthority } from "./chatScheduledTaskAuthority";
import { DelegationService } from "../auth/delegationService";
import { claimScheduledTriggerResultDto, prepareScheduledTriggerResultDto,
  reconcileScheduledTriggerResultDto, scheduledTaskResultDto, scheduledTriggerResultDto,
  startScheduledTriggerResultDto, finishScheduledTriggerResultDto,
  scheduledTaskDayResultDto } from "./chatScheduledTaskDto";
import { claimScheduledTriggerV2ResultDto, prepareScheduledTriggerV2ResultDto,
  resolveScheduledAuthorityV2ResultDto, scheduledTaskV2ResultDto } from "./chatScheduledTaskDto";
import { claimScheduledTriggerV3ResultDto, prepareScheduledTriggerV3ResultDto,
  scheduledTaskHistoryV3ResultDto, scheduledTaskV3ResultDto, scheduledTriggerV3ResultDto } from "./chatScheduledTaskDto";

const databaseUrl = process.env.SCHEDULED_CHAT_TEST_DATABASE_URL;
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "";
const enabled = process.env.SCHEDULED_CHAT_TEST_OWNED === "1"
  && /^ink_scheduled_chat_test_[a-z0-9_]+$/.test(databaseName);

describe.skipIf(!enabled)("scheduled Chat isolated PostgreSQL contract", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const database = drizzle(pool);
  const service = { id: "scheduled-chat-fixture", secret: randomBytes(32).toString("hex"),
    origin: "https://scheduled.example.test", oauthClientId: "scheduled-fixture-client",
    redirectUri: "https://scheduled.example.test/callback", backgroundScopes: ["schedule:execute" as const] };
  const longService = { ...service, id: "scheduled-chat-long-fixture",
    secret: randomBytes(32).toString("hex"), oauthClientId: "scheduled-long-client" };
  const actor: ChatThreadActor = { principal: { subject: "scheduled-subject-1", canonical_user_id: "1",
    client_id: "scheduled-fixture-client", scopes: ["dream:read", "dream:write"], status: "active" },
    threadScope: null };
  const chat = (operation: Parameters<typeof runChatThreadOperation>[0], input: unknown) =>
    database.transaction(tx => runChatThreadOperation(operation, input, actor, tx));
  const user = (operation: Parameters<typeof runChatScheduledUserOperation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledUserOperation(operation, input, actor, tx, client.id));
  const worker = (operation: Parameters<typeof runChatScheduledBackgroundOperation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledBackgroundOperation(operation, input, client, tx));
  const userV2 = (operation: Parameters<typeof runChatScheduledUserV2Operation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledUserV2Operation(operation, input, actor, tx, client.id));
  const workerV2 = (operation: Parameters<typeof runChatScheduledBackgroundV2Operation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledBackgroundV2Operation(operation, input, client, tx));
  const userV3 = (operation: Parameters<typeof runChatScheduledUserV3Operation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledUserV3Operation(operation, input, actor, tx, client.id));
  const workerV3 = (operation: Parameters<typeof runChatScheduledBackgroundV3Operation>[0], input: unknown,
    client = service) => database.transaction(tx => runChatScheduledBackgroundV3Operation(operation, input, client, tx));

  beforeAll(async () => {
    const identity = await pool.query("SELECT current_database() AS name");
    if (identity.rows[0]?.name !== databaseName) throw new Error("SCHEDULED_TEST_DATABASE_IDENTITY_MISMATCH");
    const existing = await pool.query("SELECT count(*)::int AS count FROM users");
    if (existing.rows[0]?.count !== 0) throw new Error("SCHEDULED_TEST_DATABASE_NOT_EMPTY");
    const capabilities = await pool.query(`SELECT capability FROM drizzle.schema_capabilities
      WHERE capability IN ('dream.chat-scheduled-task.v1', 'dream.chat-scheduled-task.v2', 'dream.chat-scheduled-task.v3', 'identity.scheduled-chat-runtime.v1',
        'dream.chat-scheduled-turn-binding.v1', 'dream.chat-scheduled-link-lifecycle.v1')`);
    expect(capabilities.rows).toHaveLength(6);
    process.env.AUTH_CHAT_SCHEDULE_AUTHORITY_SECRET = randomBytes(48).toString("base64url");
    process.env.AUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    process.env.AUTH_RUNTIME_DELEGATION_TTL_SECONDS = "120";
    process.env.AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS = "600";
    process.env.DREAM_DATA_SERVICE_CLIENTS = JSON.stringify([service, longService]);
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

  it("runs v3 in the source Thread, snapshots the model and records cross-task source conflicts", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "V3 source" })) as { thread_id: string };
    const base = { source_thread_id: source.thread_id, title: "Workday review", prompt: "Review the latest work",
      target_editor_session_id: null, run_thread_mode: "source_thread" as const, model_alias: "dream-balanced",
      rule: { kind: "weekly" as const, weekdays: ["MO", "TU", "WE", "TH", "FR"] as const,
        local_time: "09:00", time_zone: "Asia/Shanghai" } };
    const first = scheduledTaskV3ResultDto.parse(await userV3("scheduled-task.v3.create", {
      ...base, create_request_key: "v3-source-create",
    })).task;
    expect(first).toMatchObject({ run_thread_mode: "source_thread", model_alias: "dream-balanced",
      rule: { kind: "weekly", weekdays: ["MO", "TU", "WE", "TH", "FR"] } });
    const manual = scheduledTriggerV3ResultDto.parse(await userV3("scheduled-task.v3.run", {
      task_id: first.id, manual_request_key: "v3-source-manual",
    })).trigger;
    expect(manual).toMatchObject({ target_thread_id: source.thread_id,
      run_thread_mode_snapshot: "source_thread", model_alias_snapshot: "dream-balanced", status: "claimed" });

    const second = scheduledTaskV3ResultDto.parse(await userV3("scheduled-task.v3.create", {
      ...base, create_request_key: "v3-source-create-two", title: "Second review", model_alias: "dream-fast",
    })).task;
    const blocked = scheduledTriggerV3ResultDto.parse(await userV3("scheduled-task.v3.run", {
      task_id: second.id, manual_request_key: "v3-source-busy",
    })).trigger;
    expect(blocked).toMatchObject({ status: "failed", error_code: "SCHEDULE_SOURCE_THREAD_BUSY",
      run_thread_mode_snapshot: "source_thread", model_alias_snapshot: "dream-fast" });

    const claim = claimScheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.claim", {}));
    if (claim.action !== "dispatch" || claim.trigger.id !== manual.id) throw new Error("V3_SOURCE_CLAIM_MISSING");
    const prepared = prepareScheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.prepare", {
      trigger_id: manual.id, claim_id: claim.claim_id,
    }));
    if (!prepared.prepared) throw new Error(`V3_SOURCE_PREPARE_FAILED:${JSON.stringify(prepared)}`);
    expect(prepared).toMatchObject({ task_session: null, target_thread_id: source.thread_id,
      resume_existing_thread: true, model_alias: "dream-balanced" });
    const sourceAuthority = await database.transaction(tx => resolveScheduledChatAuthority(
      tx, prepared.authority_token, "scheduled-trigger.v3.authority.resolve", service.id));
    expect(sourceAuthority).toMatchObject({ triggerId: manual.id, claimId: claim.claim_id,
      threadScope: source.thread_id, sourceThreadScope: source.thread_id });
    const input = (await pool.query("SELECT role, parts FROM chat_message WHERE id=$1 AND thread_id=$2",
      [prepared.input_message_id, source.thread_id])).rows[0];
    expect(input).toMatchObject({ role: "user" });
    expect(JSON.stringify(input.parts)).toContain("Review the latest work");
    expect(scheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.start", {
      trigger_id: manual.id, claim_id: claim.claim_id, target_turn_id: "v3-source-turn",
    })).trigger).toMatchObject({ status: "running", task_session_id: null });
    await chat("chat-message.persist", { thread_id: source.thread_id, message_id: "v3-source-final",
      role: "assistant", parts: [{ type: "text", text: "Source result" }],
      metadata: { turnId: "v3-source-turn", turnStatus: "completed", finalPartIndex: 0 },
      history_final_text: "Source result", history_process_available: false, history_projection_version: 1 });
    expect(scheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.finish", {
      trigger_id: manual.id, claim_id: claim.claim_id, status: "succeeded",
      final_message_id: "v3-source-final", error_code: null,
    })).trigger).toMatchObject({ status: "succeeded", final_message_id: "v3-source-final" });
    const history = scheduledTaskHistoryV3ResultDto.parse(await userV3("scheduled-task.v3.history", {
      task_id: first.id, limit: 20, before_created_at: null,
    }));
    expect(history.triggers.find(item => item.id === manual.id)).toMatchObject({
      run_thread_mode_snapshot: "source_thread", model_alias_snapshot: "dream-balanced", status: "succeeded",
    });
  });

  it("creates a child Thread for v3 new-chat mode and snapshots an edited model", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "V3 child source" })) as { thread_id: string };
    const created = scheduledTaskV3ResultDto.parse(await userV3("scheduled-task.v3.create", {
      source_thread_id: source.thread_id, create_request_key: "v3-child-create", title: "Hourly review",
      prompt: "Review in a child chat", target_editor_session_id: null,
      run_thread_mode: "new_thread_each_run", model_alias: "dream-balanced",
      rule: { kind: "hourly", interval_hours: 1, minute: 0, time_zone: "Asia/Shanghai" },
    })).task;
    const edited = scheduledTaskV3ResultDto.parse(await userV3("scheduled-task.v3.edit", {
      task_id: created.id, expected_revision: created.revision, title: created.title, prompt: created.prompt,
      run_thread_mode: "new_thread_each_run", model_alias: "dream-fast",
      rule: { kind: "hourly", interval_hours: 2, minute: 15, time_zone: "Asia/Shanghai" },
    })).task;
    expect(edited).toMatchObject({ revision: created.revision + 1, model_alias: "dream-fast",
      rule: { kind: "hourly", interval_hours: 2, minute: 15 } });
    const manual = scheduledTriggerV3ResultDto.parse(await userV3("scheduled-task.v3.run", {
      task_id: edited.id, manual_request_key: "v3-child-manual",
    })).trigger;
    const claim = claimScheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.claim", {}));
    if (claim.action !== "dispatch" || claim.trigger.id !== manual.id) throw new Error("V3_CHILD_CLAIM_MISSING");
    const prepared = prepareScheduledTriggerV3ResultDto.parse(await workerV3("scheduled-trigger.v3.prepare", {
      trigger_id: manual.id, claim_id: claim.claim_id,
    }));
    if (!prepared.prepared) throw new Error(`V3_CHILD_PREPARE_FAILED:${JSON.stringify(prepared)}`);
    expect(prepared.task_session).not.toBeNull();
    expect(prepared.target_thread_id).not.toBe(source.thread_id);
    expect(prepared).toMatchObject({ resume_existing_thread: false, model_alias: "dream-fast" });
    const childAuthority = await database.transaction(tx => resolveScheduledChatAuthority(
      tx, prepared.authority_token, "scheduled-trigger.v3.authority.resolve", service.id));
    expect(childAuthority).toMatchObject({ triggerId: manual.id, claimId: claim.claim_id,
      threadScope: prepared.target_thread_id, sourceThreadScope: source.thread_id });
    expect(prepared.trigger).toMatchObject({ run_thread_mode_snapshot: "new_thread_each_run",
      model_alias_snapshot: "dream-fast" });
  });

  it("collapses missed interval points, fences concurrent claims and preserves the Editor target through unknown recovery", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "Interval source" })) as { thread_id: string };
    await pool.query("INSERT INTO user_sessions(id,user_id,name,editor_state_json) VALUES ($1,1,$2,$3)",
      ["scheduled-editor-1", "Scheduled note", JSON.stringify({ id: "scheduled-editor-1", cells: [], commentors: [], tasks: [], weightPath: [], overlappedPhrases: [], notFoundPhrases: [] })]);
    const created = scheduledTaskV2ResultDto.parse(await userV2("scheduled-task.v2.create", {
      source_thread_id: source.thread_id, create_request_key: "interval-create-1",
      title: "Every ten minutes", prompt: "Append a status note",
      target_editor_session_id: "scheduled-editor-1",
      rule: { kind: "interval", interval_minutes: 10, time_zone: "Asia/Shanghai" },
    })).task;
    expect(created.rule).toEqual({ kind: "interval", interval_minutes: 10, time_zone: "Asia/Shanghai" });
    await pool.query("UPDATE chat_scheduled_task SET next_run_at=now()-interval '31 minutes' WHERE id=$1", [created.id]);
    const claims = await Promise.all([
      workerV2("scheduled-trigger.v2.claim", {}), workerV2("scheduled-trigger.v2.claim", {}),
    ]);
    const dispatches = claims.map(value => claimScheduledTriggerV2ResultDto.parse(value))
      .filter(value => value.action === "dispatch");
    expect(dispatches).toHaveLength(1);
    const dispatch = dispatches[0];
    if (dispatch.action !== "dispatch") throw new Error("INTERVAL_DISPATCH_MISSING");
    const persisted = (await pool.query(`SELECT target_editor_session_id_snapshot, skipped_from_at,
      skipped_through_at FROM chat_scheduled_trigger WHERE id=$1`, [dispatch.trigger.id])).rows[0];
    expect(persisted.target_editor_session_id_snapshot).toBe("scheduled-editor-1");
    expect(persisted.skipped_from_at).not.toBeNull();
    expect(persisted.skipped_through_at).not.toBeNull();
    const prepared = prepareScheduledTriggerV2ResultDto.parse(await workerV2("scheduled-trigger.v2.prepare", {
      trigger_id: dispatch.trigger.id, claim_id: dispatch.claim_id,
    }));
    if (!prepared.prepared) throw new Error(`INTERVAL_PREPARE_FAILED:${JSON.stringify(prepared)}`);
    expect(prepared.target_editor_session_id).toBe("scheduled-editor-1");
    const resolved = resolveScheduledAuthorityV2ResultDto.parse(await database.transaction(async tx => {
      const authority = await resolveScheduledChatAuthority(tx, prepared.authority_token,
        "scheduled-trigger.v2.authority.resolve", service.id);
      return { trigger_id: authority.triggerId, claim_id: authority.claimId,
        service_client_id: service.id, client_id: service.oauthClientId,
        subject: authority.principal.subject, canonical_user_id: authority.principal.canonical_user_id,
        source_thread_id: authority.sourceThreadScope, target_thread_id: authority.threadScope,
        target_editor_session_id: authority.targetEditorSessionId, scopes: authority.principal.scopes,
        purpose: "scheduled-chat-persistence", issued_at: authority.issuedAt.toISOString(),
        expires_at: authority.maximumExpiresAt.toISOString() };
    }));
    expect(resolved.target_editor_session_id).toBe("scheduled-editor-1");
    const editorGrant = await database.transaction(tx => new DelegationService(tx).createForScheduledChatAuthority(
      service, prepared.authority_token, "interval-editor-grant", {
        purpose: "editor-stdio", thread_id: prepared.task_session.thread_id, run_id: null,
        editor_session_id: "scheduled-editor-1", scopes: ["editor:read", "editor:write"],
      }));
    expect(editorGrant.editor_session_id).toBe("scheduled-editor-1");
    const resolvedEditorGrant = await database.transaction(tx => new DelegationService(tx).resolve(
      editorGrant.token, "editor:read", service.id, prepared.task_session.thread_id,
      null, "scheduled-editor-1",
    ));
    expect(resolvedEditorGrant).toMatchObject({
      purpose: "editor-stdio", editorSessionId: "scheduled-editor-1",
      threadId: prepared.task_session.thread_id,
    });
    await workerV2("scheduled-trigger.v2.start", { trigger_id: dispatch.trigger.id,
      claim_id: dispatch.claim_id, target_turn_id: "interval-turn-1" });
    await workerV2("scheduled-trigger.v2.finish", { trigger_id: dispatch.trigger.id,
      claim_id: dispatch.claim_id, status: "state_unknown", final_message_id: null,
      error_code: "SCHEDULE_RESULT_UNKNOWN" });
    await pool.query("UPDATE chat_scheduled_trigger SET unknown_recheck_at=now()-interval '1 second' WHERE id=$1", [dispatch.trigger.id]);
    const reconcile = claimScheduledTriggerV2ResultDto.parse(await workerV2("scheduled-trigger.v2.claim", {}));
    expect(reconcile).toEqual({ action: "reconcile", trigger_id: dispatch.trigger.id });
    const idle = claimScheduledTriggerV2ResultDto.parse(await workerV2("scheduled-trigger.v2.claim", {}));
    expect(idle.action).toBe("idle");
  });

  it("fences claims, reuses prepared input before start and keeps history after target deletion", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null, title: "Scheduled source" })) as { thread_id: string };
    const ordinary = (await chat("task-session.create", {
      source_thread_id: source.thread_id, request_key: "ordinary-task-link",
      title: "Ordinary child task", initial_message: "Run ordinary work",
      source_message_id: null, expected_revision: null,
    })) as { task: { task_id: string; thread_id: string } | null };
    if (!ordinary.task) throw new Error("ORDINARY_TASK_SESSION_MISSING");
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
    const pausedDay = scheduledTaskDayResultDto.parse(await user("scheduled-task.day", {
      local_date: futureDate, display_time_zone: "UTC",
    }));
    expect(pausedDay.tasks.find(item => item.id === first.id)).toMatchObject({
      status: "paused", revision: paused.revision,
    });
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
    if (!prepared.prepared) throw new Error(`SCHEDULE_PREPARE_FAILED:${JSON.stringify(prepared)}`);
    expect(prepared.trigger.target_turn_id).toBeNull();
    const previousTarget = prepared.trigger.target_thread_id;
    const previousInput = prepared.trigger.input_message_id;
    if (!previousTarget || !previousInput) throw new Error("SCHEDULE_PREPARE_LINKS_MISSING");
    const sourceLinks = (await chat("task-session.links", { thread_id: source.thread_id })) as {
      created: Array<{ task_id: string }>;
    };
    expect(sourceLinks.created.map(link => link.task_id)).toEqual([ordinary.task.task_id]);
    const ordinaryTargetLinks = (await chat("task-session.links", { thread_id: ordinary.task.thread_id })) as {
      source: { task_id: string } | null;
    };
    expect(ordinaryTargetLinks.source?.task_id).toBe(ordinary.task.task_id);
    const scheduledTargetLinks = (await chat("task-session.links", { thread_id: previousTarget })) as {
      source: { task_id: string } | null;
    };
    expect(scheduledTargetLinks.source).toBeNull();
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
    expect(retryable).toMatchObject({ status: "claimed",
      target_thread_id: previousTarget, input_message_id: previousInput, target_turn_id: null });
    const cleared = (await pool.query("SELECT claim_id, lease_expires_at FROM chat_scheduled_trigger WHERE id=$1",
      [manual.id])).rows[0];
    expect(cleared).toEqual({ claim_id: null, lease_expires_at: null });
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
    if (!preparedAgain.prepared) throw new Error(`SCHEDULE_REPREPARE_FAILED:${JSON.stringify(preparedAgain)}`);
    expect(preparedAgain.trigger.target_thread_id).toBe(previousTarget);
    expect(preparedAgain.trigger.input_message_id).toBe(previousInput);
    const started = startScheduledTriggerResultDto.parse(await worker("scheduled-trigger.start", {
      trigger_id: manual.id, claim_id: reclaimed.claim_id, target_turn_id: "scheduled-target-turn",
    })).trigger;
    expect(started).toMatchObject({ status: "running", target_turn_id: "scheduled-target-turn" });
    const launch = (await pool.query("SELECT launch_status FROM chat_task_session WHERE id=$1",
      [preparedAgain.task_session.task_id])).rows[0];
    expect(launch).toEqual({ launch_status: "starting" });
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
    const manualDay = scheduledTaskDayResultDto.parse(await user("scheduled-task.day", {
      local_date: new Date(manual.created_at).toISOString().slice(0, 10), display_time_zone: "UTC",
    }));
    expect(manualDay.triggers.find(item => item.id === manual.id)).toMatchObject({
      kind: "manual", status: "succeeded", target_thread_id: previousTarget,
    });
    await expect(database.transaction(tx => resolveScheduledChatAuthority(tx,
      preparedAgain.authority_token, "chat-message.persist", service.id)))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });

    await chat("chat-thread.delete", { thread_id: previousTarget });
    const history = (await pool.query(`SELECT status, task_session_id, target_thread_id,
      input_message_id, final_message_id, target_turn_id FROM chat_scheduled_trigger WHERE id=$1`, [manual.id])).rows[0];
    expect(history).toEqual({ status: "succeeded", task_session_id: null, target_thread_id: null,
      input_message_id: null, final_message_id: null, target_turn_id: "scheduled-target-turn" });

    const failedManual = scheduledTriggerResultDto.parse(await user("scheduled-task.run", {
      task_id: first.id, manual_request_key: "manual-known-failure",
    })).trigger;
    const failureClaim = claimScheduledTriggerResultDto.parse(await worker("scheduled-trigger.claim", {}));
    if (!failureClaim.claim_id || failureClaim.trigger?.id !== failedManual.id)
      throw new Error("SCHEDULE_FAILURE_CLAIM_MISSING");
    const failurePrepared = prepareScheduledTriggerResultDto.parse(await worker("scheduled-trigger.prepare", {
      trigger_id: failedManual.id, claim_id: failureClaim.claim_id,
    }));
    if (!failurePrepared.prepared) throw new Error(`SCHEDULE_FAILURE_PREPARE_DENIED:${JSON.stringify(failurePrepared)}`);
    const failure = finishScheduledTriggerResultDto.parse(await worker("scheduled-trigger.finish", {
      trigger_id: failedManual.id, claim_id: failureClaim.claim_id, status: "failed",
      final_message_id: null, error_code: "SCHEDULE_MODEL_UNAVAILABLE",
    })).trigger;
    expect(failure).toMatchObject({ status: "failed", error_code: "SCHEDULE_MODEL_UNAVAILABLE" });
    const failedLaunch = (await pool.query("SELECT launch_status, launch_error_code FROM chat_task_session WHERE id=$1",
      [failurePrepared.task_session.task_id])).rows[0];
    expect(failedLaunch).toEqual({ launch_status: "failed", launch_error_code: "SCHEDULE_MODEL_UNAVAILABLE" });

    const deleted = scheduledTaskResultDto.parse(await user("scheduled-task.delete", {
      task_id: first.id, expected_revision: resumed.revision,
    })).task;
    const deletedDay = scheduledTaskDayResultDto.parse(await user("scheduled-task.day", {
      local_date: futureDate, display_time_zone: "UTC",
    }));
    expect(deletedDay.tasks.find(item => item.id === first.id)).toMatchObject({
      status: "deleted", revision: deleted.revision,
    });
    const restored = scheduledTaskResultDto.parse(await user("scheduled-task.restore", {
      task_id: first.id, expected_revision: deleted.revision,
    })).task;
    expect(restored.status).toBe("active");
  });

  it("keeps paused and deleted daily definitions visible on their local day", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "Daily source" })) as { thread_id: string };
    const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const created = scheduledTaskResultDto.parse(await user("scheduled-task.create", {
      source_thread_id: source.thread_id, create_request_key: "scheduled-daily-create",
      title: "Daily task", prompt: "Daily prompt",
      rule: { kind: "daily", local_time: "08:30", time_zone: "UTC" },
    })).task;
    const paused = scheduledTaskResultDto.parse(await user("scheduled-task.pause", {
      task_id: created.id, expected_revision: created.revision,
    })).task;
    const day = () => user("scheduled-task.day", { local_date: date, display_time_zone: "UTC" })
      .then(value => scheduledTaskDayResultDto.parse(value));
    expect((await day()).tasks.find(item => item.id === created.id)).toMatchObject({ status: "paused" });
    const deleted = scheduledTaskResultDto.parse(await user("scheduled-task.delete", {
      task_id: created.id, expected_revision: paused.revision,
    })).task;
    expect((await day()).tasks.find(item => item.id === created.id)).toMatchObject({ status: "deleted" });
    const restored = scheduledTaskResultDto.parse(await user("scheduled-task.restore", {
      task_id: created.id, expected_revision: deleted.revision,
    })).task;
    expect(restored.status).toBe("paused");
    expect((await day()).tasks.find(item => item.id === created.id)).toMatchObject({
      status: "paused", revision: restored.revision,
    });
    const resumed = scheduledTaskResultDto.parse(await user("scheduled-task.resume", {
      task_id: created.id, expected_revision: restored.revision,
    })).task;
    expect((await day()).tasks.find(item => item.id === created.id)).toMatchObject({
      status: "active", revision: resumed.revision,
    });
  });

  it("accepts a source-Thread-scoped create actor and rejects another Thread", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "Workflow source" })) as { thread_id: string };
    const other = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "Other source" })) as { thread_id: string };
    const scoped = { ...actor, threadScope: source.thread_id };
    const create = { source_thread_id: source.thread_id, create_request_key: "workflow-scoped-create",
      title: "Workflow scheduled task", prompt: "Continue this work",
      rule: { kind: "once", local_date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        local_time: "12:00", time_zone: "UTC", selected_offset_minutes: 0 } };
    const accepted = scheduledTaskResultDto.parse(await database.transaction(tx =>
      runChatScheduledUserOperation("scheduled-task.create", create, scoped, tx, service.id))).task;
    expect(accepted.source_thread_id).toBe(source.thread_id);
    await expect(database.transaction(tx => runChatScheduledUserOperation("scheduled-task.create",
      { ...create, source_thread_id: other.thread_id, create_request_key: "workflow-scoped-denied" },
      scoped, tx, service.id))).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED" });
  });

  it("renews grant expiry beyond the first lease with an immutable maximum", async () => {
    const source = (await chat("chat-thread.create", { deck_id: null, voice_id: null,
      title: "Long turn source" })) as { thread_id: string };
    const futureDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const definition = scheduledTaskResultDto.parse(await user("scheduled-task.create", {
      source_thread_id: source.thread_id, create_request_key: "scheduled-long-create",
      title: "Long turn", prompt: "Write a long response",
      rule: { kind: "once", local_date: futureDate, local_time: "12:00",
        time_zone: "UTC", selected_offset_minutes: 0 },
    }, longService)).task;
    const manual = scheduledTriggerResultDto.parse(await user("scheduled-task.run", {
      task_id: definition.id, manual_request_key: "scheduled-long-manual",
    }, longService)).trigger;
    const claimed = claimScheduledTriggerResultDto.parse(await worker("scheduled-trigger.claim", {}, longService));
    if (!claimed.claim_id || claimed.trigger?.id !== manual.id) throw new Error("SCHEDULE_LONG_CLAIM_MISSING");
    // A short original lease simulates a worker approaching its first lease limit.
    await pool.query("UPDATE chat_scheduled_trigger SET lease_expires_at=now()+interval '90 seconds' WHERE id=$1", [manual.id]);
    const prepared = prepareScheduledTriggerResultDto.parse(await worker("scheduled-trigger.prepare", {
      trigger_id: manual.id, claim_id: claimed.claim_id,
    }, longService));
    if (!prepared.prepared || !prepared.trigger.target_thread_id) throw new Error("SCHEDULE_LONG_PREPARE_FAILED");
    const initialGrant = await database.transaction(tx => new DelegationService(tx)
      .createForScheduledChatAuthority(longService, prepared.authority_token, "scheduled-long-grant", {
        thread_id: prepared.trigger.target_thread_id!, run_id: null, editor_session_id: null,
        purpose: "server-persistence", scopes: ["dream:read", "dream:write"],
      }));
    const initialMaximum = new Date(initialGrant.maximum_expires_at).getTime();
    const renewedLease = await worker("scheduled-trigger.renew", {
      trigger_id: manual.id, claim_id: claimed.claim_id,
    }, longService);
    expect(renewedLease).toMatchObject({ trigger: { id: manual.id } });
    const extendedGrant = await database.transaction(tx => new DelegationService(tx)
      .renew(initialGrant.token, "scheduled-long-renew-one"));
    expect(new Date(extendedGrant.maximum_expires_at).getTime()).toBe(initialMaximum);
    expect(new Date(extendedGrant.expires_at).getTime()).toBeGreaterThan(new Date(initialGrant.expires_at).getTime());
    expect(new Date(extendedGrant.expires_at).getTime()).toBeLessThanOrEqual(new Date(extendedGrant.maximum_expires_at).getTime());
    const replay = await database.transaction(tx => new DelegationService(tx)
      .renew(initialGrant.token, "scheduled-long-renew-one"));
    expect(replay).toEqual(extendedGrant);
    await database.transaction(tx => new DelegationService(tx).resolve(initialGrant.token,
      "dream:read", longService.id, prepared.trigger.target_thread_id!));

    await pool.query("UPDATE chat_scheduled_trigger SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [manual.id]);
    await expect(database.transaction(tx => new DelegationService(tx)
      .renew(initialGrant.token, "scheduled-long-expired")))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });
    await pool.query("UPDATE chat_scheduled_trigger SET claim_id=$2, lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
      [manual.id, randomUUID()]);
    await expect(database.transaction(tx => new DelegationService(tx)
      .resolve(initialGrant.token, "dream:read", longService.id, prepared.trigger.target_thread_id!)))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });
    await expect(database.transaction(tx => new DelegationService(tx)
      .renew(initialGrant.token, "scheduled-long-renew-one")))
      .rejects.toMatchObject({ code: "SCHEDULE_AUTHORITY_ENTITY_DENIED" });
  });
});
