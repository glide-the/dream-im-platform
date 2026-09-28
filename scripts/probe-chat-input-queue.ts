// [Input] Runner-owned isolated PostgreSQL URL and public Admin Chat/task-result operation services.
// [Output] Real transaction receipts for queue and target-final-to-source-claim/authorization lifecycle.
// [Sync] 2026-09-28: prove atomic target notification and exact late-final reconciliation.
// [Sync] 2026-09-28: keep a committed source result dispatching while any source owner grant is live.
// [Pos] Technical contract probe called only by run-chat-input-queue-contract.mjs.
// [Sync] 2026-09-27: verify atomic side-task transfer, replay, ownership and single first-launch claim.
// [Sync] 2026-09-26: exercise production DTO and Repository without touching normal business data.
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { AuthBoundaryError } from "../app/lib/auth/config";
import { runChatThreadOperation, type ChatThreadActor } from "../app/lib/dream/chatThreadService";
import { TaskSessionResultRepository } from "../app/lib/dream/taskSessionResultRepository";
import { claimNextTaskResult, claimTaskResult, settleTaskResult } from "../app/lib/dream/taskSessionResultService";
import { DelegationService } from "../app/lib/auth/delegationService";

const url = process.env.DREAM_DATA_DATABASE_URL;
if (!url || !url.includes("ink_chat_input_queue_test_")) throw new Error("Isolated queue database required");
const pool = new Pool({ connectionString: url });
const database = drizzle(pool);
const actor = (id: string): ChatThreadActor => ({
  principal: { subject: `probe-${id}`, canonical_user_id: id, client_id: "queue-probe",
    scopes: ["dream:read", "dream:write"], status: "active" },
  threadScope: null,
});
const own = actor("1");
const foreign = actor("2");
const run = <T>(operation: Parameters<typeof runChatThreadOperation>[0], input: unknown,
  principal = own) => database.transaction(tx => runChatThreadOperation(operation, input, principal, tx)) as Promise<T>;
const rejectsCode = async (work: () => Promise<unknown>, code: string) => {
  try { await work(); } catch (error) {
    if (error instanceof AuthBoundaryError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}`);
};

try {
  const identity = (await pool.query("SELECT current_database() AS db")).rows[0]?.db;
  if (identity !== new URL(url).pathname.slice(1)) throw new Error("Queue probe database identity changed");
  await pool.query("INSERT INTO users (id, email, password_hash) VALUES (1, 'queue-one@example.invalid', 'fixture'), (2, 'queue-two@example.invalid', 'fixture')");
  const created = await run<{ thread_id: string }>("chat-thread.create", { deck_id: null, voice_id: null, title: null });
  const thread_id = created.thread_id;
  const enqueue = (message_id: string, text: string) => run<{ entry: { message_id: string; queue_sequence: string; status: string; revision: number; dispatch_turn_id: string | null } }>(
    "chat-input.enqueue", { thread_id, message_id,
      parts_json: JSON.stringify([{ type: "text", text }]), metadata_json: null, title_candidate: text });
  const first = (await enqueue("queue-message-one", "one")).entry;
  const replay = (await enqueue("queue-message-one", "one")).entry;
  if (first.message_id !== replay.message_id || first.queue_sequence !== replay.queue_sequence || first.status !== "queued") throw new Error("Enqueue replay changed identity");
  await rejectsCode(() => enqueue("queue-message-one", "changed"), "CHAT_MESSAGE_IDENTITY_CONFLICT");
  const second = (await enqueue("queue-message-two", "two")).entry;
  const listed = await run<{ entries: Array<{ message_id: string; status: string }> }>("chat-input.list", { thread_id });
  if (listed.entries.map(entry => entry.message_id).join(",") !== "queue-message-one,queue-message-two") throw new Error("Queue order changed");
  await rejectsCode(() => run("chat-input.list", { thread_id }, foreign), "CHAT_THREAD_NOT_FOUND");
  const transition = (message_id: string, expected_revision: number, action: "select" | "claim" | "consume" | "mark_unknown", dispatch_turn_id: string | null) =>
    run<{ entry: { status: string; revision: number } }>("chat-input.transition", { thread_id, message_id, expected_revision, action, dispatch_turn_id });
  const selected = (await transition(second.message_id, second.revision, "select", null)).entry;
  if (selected.status !== "selected") throw new Error("Selected state was not persisted");
  await rejectsCode(() => transition(first.message_id, first.revision, "claim", "turn-first"), "CHAT_INPUT_SELECTION_CONFLICT");
  const claimed = (await transition(second.message_id, selected.revision, "claim", "turn-second")).entry;
  if (claimed.status !== "dispatching") throw new Error("Claim state was not persisted");
  await rejectsCode(() => transition(first.message_id, first.revision, "claim", "turn-first"), "CHAT_INPUT_DISPATCH_CONFLICT");
  const consumed = (await transition(second.message_id, claimed.revision, "consume", "turn-second")).entry;
  if (consumed.status !== "consumed") throw new Error("Consumption was not persisted");
  await rejectsCode(() => transition(second.message_id, consumed.revision, "select", null), "CHAT_INPUT_STATE_CONFLICT");
  const firstClaim = (await transition(first.message_id, first.revision, "claim", "turn-first")).entry;
  const unknown = (await transition(first.message_id, firstClaim.revision, "mark_unknown", "turn-first")).entry;
  if (unknown.status !== "state_unknown") throw new Error("Uncertain dispatch was not persisted");
  const final = await run<{ entries: Array<{ status: string }> }>("chat-input.list", { thread_id });
  if (final.entries.map(entry => entry.status).join(",") !== "state_unknown,consumed") throw new Error("Final queue state changed");
  const movedInput = (await enqueue("queue-message-side", "open separately")).entry;
  const createTaskInput = { source_thread_id: thread_id, request_key: "side:queue-message-side", title: "Separate work",
    initial_message: "open separately", source_message_id: movedInput.message_id, expected_revision: movedInput.revision };
  const task = (await run<{ task: { task_id: string; thread_id: string; initial_message_id: string; launch_status: string } }>("task-session.create", createTaskInput)).task;
  const taskReplay = (await run<{ task: { task_id: string } }>("task-session.create", createTaskInput)).task;
  if (task.task_id !== taskReplay.task_id || task.thread_id === thread_id || task.launch_status !== "pending") throw new Error("Task creation replay or independent Thread failed");
  const movedState = await run<{ entries: Array<{ message_id: string; status: string }> }>("chat-input.list", { thread_id });
  if (movedState.entries.find(entry => entry.message_id === movedInput.message_id)?.status !== "cancelled") throw new Error("Side transfer did not cancel original input");
  await rejectsCode(() => run("task-session.create", { ...createTaskInput, request_key: "side:changed", expected_revision: movedInput.revision }), "CHAT_INPUT_STATE_CONFLICT");
  await rejectsCode(() => run("task-session.get", { source_thread_id: thread_id, task_id: task.task_id }, foreign), "CHAT_THREAD_NOT_FOUND");
  const claim = await run<{ changed: boolean; task: { launch_status: string } }>("task-session.launch", { source_thread_id: thread_id, task_id: task.task_id, action: "claim", error_code: null });
  const secondClaim = await run<{ changed: boolean; task: { launch_status: string } }>("task-session.launch", { source_thread_id: thread_id, task_id: task.task_id, action: "claim", error_code: null });
  if (!claim.changed || claim.task.launch_status !== "starting" || secondClaim.changed) throw new Error("Task launch was not single-claim");
  const failed = await run<{ changed: boolean; task: { launch_status: string; launch_error_code: string } }>("task-session.launch", { source_thread_id: thread_id, task_id: task.task_id, action: "fail", error_code: "TASK_SESSION_LAUNCH_FAILED" });
  if (!failed.changed || failed.task.launch_status !== "failed") throw new Error("Task launch failure was not persisted");
  const returnSource = (await run<{ thread_id: string }>("chat-thread.create", { deck_id: null, voice_id: null, title: "Source" })).thread_id;
  await run("chat-thread.update-session", { thread_id: returnSource, claude_session_id: "source-sdk-session", agent_contract_version: "fixture" });
  const returning = (await run<{ task: { task_id: string; thread_id: string } }>("task-session.create-returning", {
    source_thread_id: returnSource, request_key: "return-request", title: "Research",
    initial_message: "Research the topic", source_message_id: null, expected_revision: null,
  })).task;
  await rejectsCode(() => run("task-session.create", { source_thread_id: returnSource, request_key: "return-request",
    title: "Research", initial_message: "Research the topic", source_message_id: null, expected_revision: null }), "TASK_SESSION_IDENTITY_CONFLICT");
  const targetFinal = { thread_id: returning.thread_id, message_id: "target-final", role: "assistant" as const,
    parts: [{ type: "text", text: "Verified result" }],
    metadata: { turnId: "target-turn", turnStatus: "completed", finalPartIndex: 0 },
    history_final_text: "Verified result", history_process_available: false, history_projection_version: 1 as const };
  await run("chat-message.persist", targetFinal);
  const automatic = (await pool.query(`SELECT id, target_final_message_id, status, revision
    FROM chat_task_result WHERE task_id = $1 AND target_turn_id = $2`, [returning.task_id, "target-turn"])).rows;
  if (automatic.length !== 1 || automatic[0].target_final_message_id !== targetFinal.message_id
    || automatic[0].status !== "pending" || automatic[0].revision !== 1)
    throw new Error("Target final persistence did not atomically create one pending notification");
  const committed = await database.transaction(tx => new TaskSessionResultRepository(tx).commit({
    target_thread_id: returning.thread_id, target_turn_id: "target-turn", target_final_message_id: "target-final",
  }, "1"));
  if (!committed || committed.notification_id !== automatic[0].id
    || committed.status !== "pending" || committed.task_id !== returning.task_id)
    throw new Error("Final assistant message did not atomically create task result");
  await rejectsCode(() => database.transaction(tx => new TaskSessionResultRepository(tx).commit({
    target_thread_id: returning.thread_id, target_turn_id: "target-turn", target_final_message_id: "target-final",
  }, "2")), "CHAT_THREAD_NOT_FOUND");
  await rejectsCode(() => database.transaction(tx => new TaskSessionResultRepository(tx).commit({
    target_thread_id: returning.thread_id, target_turn_id: "target-turn", target_final_message_id: "wrong-final",
  }, "1")), "TASK_SESSION_FINAL_NOT_COMMITTED");
  await pool.query(`INSERT INTO identity."user" (id, name, email, "createdAt", "updatedAt")
    VALUES ('subject-one', 'Fixture', 'fixture@example.invalid', now(), now())`);
  await pool.query(`INSERT INTO identity.subject_links (auth_user_id, canonical_user_id, evidence)
    VALUES ('subject-one', 1, 'fixture')`);
  await pool.query(`INSERT INTO gateway_api_keys (id, subject_mode, service_client_id, name, key_prefix, key_hash, scopes)
    VALUES ('gateway-fixture', 'canonical_subject', 'gateway-service', 'fixture', 'fixture', 'fixture-hash',
      ARRAY['messages:create','messages:count_tokens','models:list'])`);
  process.env.AUTH_RUNTIME_DELEGATION_TTL_SECONDS = "120";
  process.env.AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS = "600";
  process.env.DREAM_DATA_MAX_BODY_BYTES = "65536";
  process.env.AUTH_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  process.env.DREAM_GATEWAY_CLIENT_BINDINGS = JSON.stringify([{
    service_client_id: "dream-fixture", gateway_client_id: "gateway-service", oauth_client_ids: ["oauth-fixture"],
  }]);
  const service = { id: "dream-fixture", secret: randomBytes(32).toString("hex"),
    origin: "http://localhost:3000", oauthClientId: "oauth-fixture", redirectUri: "http://localhost:3000/callback",
    backgroundScopes: ["task-return:dispatch" as const] };
  process.env.DREAM_DATA_SERVICE_CLIENTS = JSON.stringify([service]);
  const claimInput = { notification_id: committed.notification_id, expected_revision: committed.revision, source_turn_id: "source-turn" };
  process.env.DREAM_DATA_MAX_BODY_BYTES = "1";
  await rejectsCode(() => database.transaction(tx => claimTaskResult(tx, service, claimInput)), "TASK_SESSION_RETURN_INPUT_TOO_LARGE");
  process.env.DREAM_DATA_MAX_BODY_BYTES = "65536";
  const resultClaimed = await database.transaction(tx => claimTaskResult(tx, service, claimInput));
  if (resultClaimed.result.status !== "dispatching" || resultClaimed.actor_id !== "1"
    || resultClaimed.source_session_id !== "source-sdk-session"
    || resultClaimed.source_persistence_authorization.purpose !== "server-persistence"
    || resultClaimed.source_gateway_authorization.purpose !== "gateway-cli"
    || !resultClaimed.source_input_message_id || !resultClaimed.source_input_text.includes("Verified result")
    || resultClaimed.source_input_text.includes(returning.task_id)
    || resultClaimed.source_input_text.includes("target-turn"))
    throw new Error("Task result claim did not return bounded source continuation");
  const claimReplay = await database.transaction(tx => claimTaskResult(tx, service, claimInput));
  if (claimReplay.source_persistence_authorization.token !== resultClaimed.source_persistence_authorization.token
    || claimReplay.source_gateway_authorization.token !== resultClaimed.source_gateway_authorization.token)
    throw new Error("Task result claim lost encrypted token recovery");
  await rejectsCode(() => database.transaction(tx => claimTaskResult(tx, service,
    { ...claimInput, source_turn_id: "different-turn" })), "TASK_SESSION_RESULT_REVISION_CONFLICT");
  await database.transaction(async tx => {
    const delegation = new DelegationService(tx);
    await delegation.resolve(resultClaimed.source_persistence_authorization.token, "dream:write", service.id, returnSource);
    await delegation.resolve(resultClaimed.source_gateway_authorization.token, "messages:create", service.id, returnSource);
  });
  await run("chat-message.persist", { thread_id: returnSource, message_id: "source-final", role: "assistant",
    parts: [{ type: "text", text: "Handled result" }],
    metadata: { turnId: "source-turn", turnStatus: "completed", finalPartIndex: 0,
      taskResultNotificationId: committed.notification_id },
    history_final_text: "Handled result", history_process_available: false, history_projection_version: 1 });
  const settled = await database.transaction(tx => settleTaskResult(tx, service, {
    notification_id: committed.notification_id, expected_revision: resultClaimed.result.revision,
    claim_id: resultClaimed.result.claim_id!, action: "delivered",
  }));
  if (settled.result.status !== "delivered") throw new Error("Task result delivery was not persisted");
  await rejectsCode(() => database.transaction(tx => new DelegationService(tx).resolve(
    resultClaimed.source_gateway_authorization.token, "messages:create", service.id, returnSource)), "DELEGATION_REQUIRED");
  const blockedSource = (await run<{ thread_id: string }>("chat-thread.create", { deck_id: null, voice_id: null, title: "Blocked" })).thread_id;
  const freeSource = (await run<{ thread_id: string }>("chat-thread.create", { deck_id: null, voice_id: null, title: "Free" })).thread_id;
  for (const source of [blockedSource, freeSource])
    await run("chat-thread.update-session", { thread_id: source, claude_session_id: `sdk-${source}`, agent_contract_version: "fixture" });
  const makeReturn = async (source: string, label: string) => {
    const created = (await run<{ task: { thread_id: string } }>("task-session.create-returning", {
      source_thread_id: source, request_key: `return-${label}`, title: label,
      initial_message: label, source_message_id: null, expected_revision: null,
    })).task;
    await run("chat-message.persist", { thread_id: created.thread_id, message_id: `final-${label}`,
      role: "assistant", parts: [{ type: "text", text: label }],
      metadata: { turnId: `turn-${label}`, turnStatus: "completed", finalPartIndex: 0 },
      history_final_text: label, history_process_available: false, history_projection_version: 1 });
  };
  await makeReturn(blockedSource, "blocked-result");
  await run("chat-input.enqueue", { thread_id: blockedSource, message_id: "blocking-user-input",
    parts_json: JSON.stringify([{ type: "text", text: "before result" }]), metadata_json: null, title_candidate: "before result" });
  await makeReturn(freeSource, "free-result");
  const next = await database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-one"));
  if (!next.claim || next.claim.result.source_thread_id !== freeSource) throw new Error("Global recovery did not skip blocked source");
  const nextReplay = await database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-one"));
  if (nextReplay.claim?.source_gateway_authorization.token !== next.claim.source_gateway_authorization.token)
    throw new Error("Global claim lost exact request recovery");
  const uncertain = await database.transaction(tx => settleTaskResult(tx, service, {
    notification_id: next.claim!.result.notification_id, expected_revision: next.claim!.result.revision,
    claim_id: next.claim!.result.claim_id!, action: "mark_unknown", error_code: "TASK_SESSION_RETURN_OWNER_UNKNOWN",
  }));
  if (uncertain.result.status !== "state_unknown") throw new Error("Uncertain source result was not fenced");
  await rejectsCode(() => database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-one")), "TASK_SESSION_RETURN_STATE_UNKNOWN");
  await run("chat-message.persist", { thread_id: freeSource, message_id: "source-late-final", role: "assistant",
    parts: [{ type: "text", text: "Late verified answer" }],
    metadata: { turnId: next.claim.result.source_turn_id, turnStatus: "completed", finalPartIndex: 0,
      taskResultNotificationId: next.claim.result.notification_id },
    history_final_text: "Late verified answer", history_process_available: false, history_projection_version: 1 });
  const lateCard = (await database.transaction(tx => new TaskSessionResultRepository(tx)
    .list(freeSource, "1", "late-final-owner-read")))
    .find(item => item.notification_id === next.claim!.result.notification_id);
  if (lateCard?.status !== "delivered" || lateCard.source_final_message_id !== "source-late-final")
    throw new Error("Owner list did not reconcile one exact late source final");
  await rejectsCode(() => database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-one")), "TASK_SESSION_RETURN_STATE_UNKNOWN");
  await makeReturn(freeSource, "recovered-delivery");
  const deliveryCard = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "delivery-owner-read")))
    .find(item => item.target_turn_id === "turn-recovered-delivery");
  if (!deliveryCard) throw new Error("Recovery delivery card missing");
  const deliveryClaim = await database.transaction(tx => claimTaskResult(tx, service, {
    notification_id: deliveryCard.notification_id, expected_revision: deliveryCard.revision,
    source_turn_id: "source-recovered-delivery",
  }));
  await run("chat-message.persist", { thread_id: freeSource, message_id: "source-recovered-final", role: "assistant",
    parts: [{ type: "text", text: "Recovered answer" }],
    metadata: { turnId: "source-recovered-delivery", turnStatus: "completed", finalPartIndex: 0,
      taskResultNotificationId: deliveryCard.notification_id },
    history_final_text: "Recovered answer", history_process_available: false, history_projection_version: 1 });
  await database.transaction(tx => claimNextTaskResult(tx, service, "reconcile-live-owner"));
  const whileLive = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "live-owner-read")))
    .find(item => item.notification_id === deliveryCard.notification_id);
  if (whileLive?.status !== "dispatching" || whileLive.revision !== deliveryClaim.result.revision)
    throw new Error("Recovery settled a result before its source owner grant ended");
  await database.transaction(tx => new DelegationService(tx).resolve(
    deliveryClaim.source_persistence_authorization.token, "dream:read", service.id, freeSource));
  await pool.query(`UPDATE identity.runtime_delegations SET expires_at = clock_timestamp() - interval '1 second'
    WHERE source_task_result_id = $1 AND purpose = 'gateway-cli'`, [deliveryCard.notification_id]);
  await database.transaction(tx => claimNextTaskResult(tx, service, "reconcile-one-live-grant"));
  const withOneGrant = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "one-grant-read")))
    .find(item => item.notification_id === deliveryCard.notification_id);
  if (withOneGrant?.status !== "dispatching" || withOneGrant.revision !== deliveryClaim.result.revision)
    throw new Error("Recovery fenced a still-active source persistence grant");
  await database.transaction(tx => new DelegationService(tx).resolve(
    deliveryClaim.source_persistence_authorization.token, "dream:read", service.id, freeSource));
  await pool.query(`UPDATE identity.runtime_delegations SET expires_at = clock_timestamp() - interval '1 second'
    WHERE source_task_result_id = $1`, [deliveryCard.notification_id]);
  await database.transaction(tx => claimNextTaskResult(tx, service, "reconcile-delivery"));
  const deliveredByRecovery = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "recovery-owner-read")))
    .find(item => item.notification_id === deliveryCard.notification_id);
  if (deliveredByRecovery?.status !== "delivered" || deliveredByRecovery.source_final_message_id !== "source-recovered-final")
    throw new Error("Recovery did not verify committed source final");
  await makeReturn(freeSource, "recovered-unknown");
  const unknownCard = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "unknown-owner-read")))
    .find(item => item.target_turn_id === "turn-recovered-unknown");
  if (!unknownCard) throw new Error("Recovery unknown card missing");
  await database.transaction(tx => claimTaskResult(tx, service, {
    notification_id: unknownCard.notification_id, expected_revision: unknownCard.revision,
    source_turn_id: "source-recovered-unknown",
  }));
  await pool.query(`UPDATE identity.runtime_delegations SET expires_at = clock_timestamp() - interval '1 second'
    WHERE source_task_result_id = $1`, [unknownCard.notification_id]);
  await database.transaction(tx => claimNextTaskResult(tx, service, "reconcile-expired"));
  const unknownByRecovery = (await database.transaction(tx => new TaskSessionResultRepository(tx).list(freeSource, "1", "expired-owner-read")))
    .find(item => item.notification_id === unknownCard.notification_id);
  if (unknownByRecovery?.status !== "state_unknown") throw new Error("Expired claim was not fenced as uncertain");
  const none = await database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-two"));
  if (none.claim !== null) throw new Error("Blocked source should remain pending");
  const noneReplay = await database.transaction(tx => claimNextTaskResult(tx, service, "recovery-request-two"));
  if (noneReplay.claim !== null) throw new Error("Empty recovery receipt was not stable");
  process.stdout.write(JSON.stringify({ status: "passed", entries: final.entries.length, replay: true, owner_guard: true,
    selected: true, consumed: true, unknown: true, task_binding: true, task_single_claim: true,
    task_completion_atomic: true, source_claim_recovery: true, source_grants_fenced: true,
    recovery_skips_blocked_source: true, recovery_verifies_final: true,
    recovery_fences_expired_claim: true, late_final_reconciled: true,
    handoff_receipt: {
      task_id: returning.task_id, target_thread_id: returning.thread_id,
      target_final_message_id: targetFinal.message_id,
      notification_id: committed.notification_id, pending_revision: committed.revision,
      claim_id: resultClaimed.result.claim_id, dispatching_revision: resultClaimed.result.revision,
      source_input_message_id: resultClaimed.source_input_message_id,
      source_final_message_id: settled.result.source_final_message_id,
      delivered_revision: settled.result.revision,
      global_claim_notification_id: next.claim.result.notification_id,
      global_claim_replay_same_authority: true, terminal_request_does_not_reclaim: true,
    } }) + "\n");
} finally {
  await pool.end();
}
