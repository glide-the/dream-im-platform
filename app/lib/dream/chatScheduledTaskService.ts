// [Input] Strict scheduled-task DTO, verified OAuth/Thread actor or scoped service and one capability-gated transaction.
// [Output] Owner-filtered effective definitions, date/history projections, fenced claims and TaskSession preparation.
// [Pos] Admin scheduled Chat domain service and repository boundary; Dream owns the shared Chat runtime and model admission.
// [Sync] 2026-09-28: reclaim pre-model expiries, suppress inactive manual runs and compare canonical identity across bigint projections.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { chat_scheduled_task as task, chat_scheduled_trigger as trigger, chat_message as message } from "@ink-memory/db/schema/dream";
import { chatScheduledTaskPolicy } from "../../../config/chat-scheduled-task-policy";
import { AuthBoundaryError, type DreamServiceClient } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import { SubjectRepository } from "../auth/subjectRepository";
import type { DataTransaction, SchemaRequirement } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";
import { chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { pgTimestampToIso, taskSessionCreateInputDto } from "./chatThreadDto";
import { addLocalDays, latestDailyInstant, localDayBounds, nextDailyInstant, onceInstant, utcCandidates } from "./chatScheduledTaskTime";
import { issueScheduledChatAuthority, resolveScheduledChatClaim } from "./chatScheduledTaskAuthority";
import * as dto from "./chatScheduledTaskDto";
import scheduleContract from "../../../drizzle/contracts/dream-chat-scheduled-task-v1.json";
import turnBindingContract from "../../../drizzle/contracts/dream-chat-scheduled-turn-binding-v1.json";
import linkLifecycleContract from "../../../drizzle/contracts/dream-chat-scheduled-link-lifecycle-v1.json";

export const chatScheduledTaskSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-task.v1", version: 1, contractSha256: scheduleContract.contract_sha256 };
export const chatScheduledTurnBindingSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-turn-binding.v1", version: 1, contractSha256: turnBindingContract.contract_sha256 };
export const chatScheduledLinkLifecycleSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-link-lifecycle.v1", version: 1, contractSha256: linkLifecycleContract.contract_sha256 };
export const chatScheduledTaskSchemaRequirements = [dreamUnifiedSchemaRequirement, chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, chatScheduledTaskSchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement] as const;
export type ScheduledTaskActor = { principal: PrincipalDto; threadScope: string | null };
export type ScheduledTaskService = Pick<DreamServiceClient, "id"> & { backgroundScopes: readonly string[] };
type TaskRow = typeof task.$inferSelect;
type TriggerRow = typeof trigger.$inferSelect;
function instant(value: string | null) { return value === null ? null : pgTimestampToIso(value); }
function taskRule(row: TaskRow) {
  return row.schedule_kind === "once"
    ? dto.scheduledRuleDto.parse({ kind: "once", local_date: row.local_date, local_time: row.local_time, time_zone: row.time_zone, selected_offset_minutes: row.single_offset_minutes })
    : dto.scheduledRuleDto.parse({ kind: "daily", local_time: row.local_time, time_zone: row.time_zone });
}
function sameCreateRule(row: TaskRow, rule: z.infer<typeof dto.scheduledRuleDto>) {
  if (row.schedule_kind !== rule.kind || row.local_time !== rule.local_time || row.time_zone !== rule.time_zone) return false;
  if (rule.kind === "daily") return true;
  if (row.local_date !== rule.local_date) return false;
  return row.single_offset_minutes === onceInstant(rule.local_date, rule.local_time, rule.time_zone, rule.selected_offset_minutes).offsetMinutes;
}
function projectTask(row: TaskRow) {
  return dto.scheduledTaskDto.parse({ id: row.id, source_thread_id: row.source_thread_id, title: row.title, prompt: row.prompt,
    rule: taskRule(row), next_run_at: instant(row.next_run_at), status: row.status, revision: row.revision,
    created_at: instant(row.created_at), updated_at: instant(row.updated_at) });
}
function projectTrigger(row: TriggerRow) {
  return dto.scheduledTriggerDto.parse({ id: row.id, task_id: row.task_id, kind: row.kind, scheduled_at: instant(row.scheduled_at),
    definition_revision: row.definition_revision, title: row.title_snapshot, source_thread_id: row.source_thread_id,
    time_zone: row.time_zone_snapshot, status: row.status, task_session_id: row.task_session_id,
    target_thread_id: row.target_thread_id, input_message_id: row.input_message_id, target_turn_id: row.target_turn_id, final_message_id: row.final_message_id,
    error_code: row.error_code, skipped_from_at: instant(row.skipped_from_at), skipped_through_at: instant(row.skipped_through_at),
    created_at: instant(row.created_at), updated_at: instant(row.updated_at) });
}
function isCompletedTurn(metadataText: string | null, targetTurnId: string) {
  try {
    const metadata: unknown = JSON.parse(metadataText ?? "null");
    return !!metadata && typeof metadata === "object" && !Array.isArray(metadata)
      && "turnStatus" in metadata && metadata.turnStatus === "completed"
      && "turnId" in metadata && metadata.turnId === targetTurnId;
  } catch { return false; }
}
async function databaseNow(tx: DataTransaction) {
  const result = await tx.execute(sql<{ now: string }>`SELECT CURRENT_TIMESTAMP::text AS now`);
  const row = result.rows[0] as { now: string } | undefined;
  if (!row) throw new AuthBoundaryError("SCHEDULE_DATABASE_CLOCK_UNAVAILABLE");
  return new Date(row.now);
}
function plan(rule: z.infer<typeof dto.scheduledRuleDto>, now: Date) {
  if (rule.kind === "once") {
    const candidate = onceInstant(rule.local_date, rule.local_time, rule.time_zone, rule.selected_offset_minutes);
    if (candidate.instant <= now) throw new AuthBoundaryError("SCHEDULE_TIME_NOT_FUTURE", 400);
    return { next: candidate.instant.toISOString(), offset: candidate.offsetMinutes };
  }
  return { next: nextDailyInstant(now, rule.local_time, rule.time_zone).toISOString(), offset: null };
}
function assertUser(actor: ScheduledTaskActor, scope: "dream:read" | "dream:write") {
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(scope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  return principal;
}
class ScheduledTaskRepository {
  constructor(readonly tx: DataTransaction, readonly userId?: string) {}
  async owned(taskId: string, lock = false) {
    if (!this.userId) throw new AuthBoundaryError("SCHEDULE_OWNER_REQUIRED", 403);
    const query = this.tx.select().from(task).where(and(eq(task.id, taskId), eq(task.user_id, sql`${this.userId}::bigint`))).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }
  async serviceTask(taskId: string, serviceId: string, lock = false) {
    const query = this.tx.select().from(task).where(and(eq(task.id, taskId), eq(task.service_client_id, serviceId))).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }
  async trigger(triggerId: string, lock = false) {
    const query = this.tx.select().from(trigger).where(eq(trigger.id, triggerId)).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return rows[0] ?? null;
  }
  async open(taskId: string) {
    return (await this.tx.select().from(trigger).where(and(eq(trigger.task_id, taskId), sql`${trigger.status} IN ('claimed','queued','running','state_unknown')`)).limit(1))[0] ?? null;
  }
}
async function currentIdentity(tx: DataTransaction, principal: PrincipalDto) {
  const row = await new SubjectRepository(tx).findActive(principal.subject);
  if (!row || String(row.canonicalUserId) !== principal.canonical_user_id) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
}
async function sourceOwned(tx: DataTransaction, userId: string, sourceThreadId: string) {
  await new ChatThreadRepository(tx, userId).requireOwned(sourceThreadId);
}
function requireRevision(row: TaskRow, expected: number) {
  if (row.revision !== expected) throw new AuthBoundaryError("SCHEDULE_REVISION_CONFLICT", 409);
}
function nextForRestore(row: TaskRow, now: Date) {
  if (row.schedule_kind === "daily") return nextDailyInstant(now, row.local_time, row.time_zone).toISOString();
  if (row.status_before_delete === "exhausted") return null;
  const date = row.local_date!;
  const candidate = onceInstant(date, row.local_time, row.time_zone, row.single_offset_minutes);
  return candidate.instant > now ? candidate.instant.toISOString() : null;
}

export async function runChatScheduledUserOperation(name: dto.ChatScheduledUserOperation, raw: unknown, actor: ScheduledTaskActor, tx: DataTransaction, serviceId: string) {
  const contract = dto.chatScheduledTaskOperationContracts[name];
  const parsed = contract.input.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = assertUser(actor, contract.userScope);
  if (actor.threadScope !== null && name !== "scheduled-task.create") throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
  await currentIdentity(tx, principal);
  const store = new ScheduledTaskRepository(tx, principal.canonical_user_id);
  const now = await databaseNow(tx);
  if (name === "scheduled-task.create") {
    const input = dto.createScheduledTaskInputDto.parse(parsed.data);
    if (actor.threadScope !== null && actor.threadScope !== input.source_thread_id) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    await sourceOwned(tx, principal.canonical_user_id, input.source_thread_id);
    const existing = (await tx.select().from(task).where(and(eq(task.service_client_id, serviceId), eq(task.auth_user_id, principal.subject), eq(task.create_request_key, input.create_request_key))).limit(1))[0];
    if (existing) {
      if (existing.source_thread_id !== input.source_thread_id || existing.title !== input.title || existing.prompt !== input.prompt
        || !sameCreateRule(existing, input.rule)) throw new AuthBoundaryError("SCHEDULE_CREATE_IDENTITY_CONFLICT", 409);
      return dto.scheduledTaskResultDto.parse({ task: projectTask(existing) });
    }
    const schedule = plan(input.rule, now);
    const row = (await tx.insert(task).values({ id: randomUUID(), user_id: Number(principal.canonical_user_id),
      auth_user_id: principal.subject, service_client_id: serviceId, source_thread_id: input.source_thread_id,
      create_request_key: input.create_request_key, title: input.title, prompt: input.prompt,
      schedule_kind: input.rule.kind, time_zone: input.rule.time_zone,
      local_date: input.rule.kind === "once" ? input.rule.local_date : null, local_time: input.rule.local_time,
      single_offset_minutes: schedule.offset, next_run_at: schedule.next, status: "active" }).returning())[0]!;
    return dto.scheduledTaskResultDto.parse({ task: projectTask(row) });
  }
  if (name === "scheduled-task.day") {
    const input = dto.dayScheduledTaskInputDto.parse(parsed.data);
    const bounds = localDayBounds(input.local_date, input.display_time_zone);
    const rows = await tx.select().from(task).where(eq(task.user_id, sql`${principal.canonical_user_id}::bigint`));
    const matching = rows.filter(row => {
      if (row.status !== "active" || !row.next_run_at) return false;
      if (row.schedule_kind === "once") {
        const candidate = onceInstant(row.local_date!, row.local_time, row.time_zone, row.single_offset_minutes).instant;
        return candidate >= bounds.from && candidate < bounds.until;
      }
      for (let day = -1; day <= 1; day++) {
        const sourceDate = addLocalDays(input.local_date, day);
        const candidate = utcCandidates(sourceDate, row.local_time, row.time_zone)[0]?.instant;
        if (candidate && candidate >= bounds.from && candidate < bounds.until && candidate >= new Date(row.next_run_at)) return true;
      }
      return false;
    });
    const triggers = await tx.select().from(trigger).where(and(eq(trigger.user_id, sql`${principal.canonical_user_id}::bigint`), gte(trigger.scheduled_at, bounds.from.toISOString()), lt(trigger.scheduled_at, bounds.until.toISOString()))).orderBy(asc(trigger.scheduled_at));
    return dto.scheduledTaskDayResultDto.parse({ tasks: matching.map(projectTask), triggers: triggers.map(projectTrigger) });
  }
  const input = dto.scheduledTaskIdInputDto.parse(parsed.data);
  const row = await store.owned(input.task_id, contract.kind === "write");
  if (!row) {
    if (name === "scheduled-task.get") return dto.scheduledTaskNullableResultDto.parse({ task: null });
    throw new AuthBoundaryError("SCHEDULE_TASK_NOT_FOUND", 404);
  }
  await sourceOwned(tx, principal.canonical_user_id, row.source_thread_id);
  if (name === "scheduled-task.get") return dto.scheduledTaskNullableResultDto.parse({ task: projectTask(row) });
  if (name === "scheduled-task.history") {
    const value = dto.historyScheduledTaskInputDto.parse(parsed.data);
    if (value.limit > chatScheduledTaskPolicy.historyPageMaximum) throw new AuthBoundaryError("SCHEDULE_HISTORY_LIMIT", 400);
    const history = await tx.select().from(trigger).where(and(eq(trigger.task_id, row.id), value.before_created_at ? lt(trigger.created_at, value.before_created_at) : undefined)).orderBy(desc(trigger.created_at), desc(trigger.id)).limit(value.limit);
    return dto.scheduledTaskHistoryResultDto.parse({ triggers: history.map(projectTrigger) });
  }
  if (name === "scheduled-task.run") {
    const value = dto.runScheduledTaskInputDto.parse(parsed.data);
    if (!["active", "exhausted"].includes(row.status)) throw new AuthBoundaryError("SCHEDULE_TASK_INACTIVE", 409);
    const previous = (await tx.select().from(trigger).where(and(eq(trigger.task_id, row.id), eq(trigger.kind, "manual"), eq(trigger.manual_request_key, value.manual_request_key))).limit(1))[0];
    if (previous) return dto.scheduledTriggerResultDto.parse({ trigger: projectTrigger(previous) });
    const open = await store.open(row.id);
    if (open) return dto.scheduledTriggerResultDto.parse({ trigger: projectTrigger(open) });
    const created = (await tx.insert(trigger).values({ id: randomUUID(), task_id: row.id, user_id: row.user_id,
      kind: "manual", manual_request_key: value.manual_request_key, definition_revision: row.revision,
      title_snapshot: row.title, prompt_snapshot: row.prompt, source_thread_id: row.source_thread_id,
      time_zone_snapshot: row.time_zone, status: "claimed" }).returning())[0]!;
    return dto.scheduledTriggerResultDto.parse({ trigger: projectTrigger(created) });
  }
  const change = dto.scheduledTaskRevisionInputDto.parse(parsed.data);
  requireRevision(row, change.expected_revision);
  if (name === "scheduled-task.edit") {
    if (row.status === "deleted" || row.status === "exhausted") throw new AuthBoundaryError("SCHEDULE_TASK_INACTIVE", 409);
    const value = dto.editScheduledTaskInputDto.parse(parsed.data);
    const planned = plan(value.rule, now);
    const next = row.status === "paused" ? null : planned.next;
    const changed = (await tx.update(task).set({ title: value.title, prompt: value.prompt,
      schedule_kind: value.rule.kind, time_zone: value.rule.time_zone, local_date: value.rule.kind === "once" ? value.rule.local_date : null,
      local_time: value.rule.local_time, single_offset_minutes: planned.offset, next_run_at: next,
      revision: row.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(task.id, row.id), eq(task.revision, row.revision))).returning())[0];
    if (!changed) throw new AuthBoundaryError("SCHEDULE_REVISION_CONFLICT", 409);
    return dto.scheduledTaskResultDto.parse({ task: projectTask(changed) });
  }
  let status = row.status, before = row.status_before_delete, next = row.next_run_at;
  if (name === "scheduled-task.pause") {
    if (status !== "active") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    status = "paused"; next = null;
  } else if (name === "scheduled-task.resume") {
    if (status !== "paused") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    next = row.schedule_kind === "daily" ? nextDailyInstant(now, row.local_time, row.time_zone).toISOString() : nextForRestore({ ...row, status_before_delete: "active" }, now);
    status = next ? "active" : "exhausted";
  } else if (name === "scheduled-task.delete") {
    if (status === "deleted") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    before = status; status = "deleted"; next = null;
  } else if (name === "scheduled-task.restore") {
    if (status !== "deleted" || before === null) throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    status = before; next = status === "active" ? nextForRestore(row, now) : null;
    if (status === "active" && next === null) status = "exhausted";
    before = null;
  } else throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const changed = (await tx.update(task).set({ status, status_before_delete: before, next_run_at: next,
    revision: row.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(task.id, row.id), eq(task.revision, row.revision))).returning())[0];
  if (!changed) throw new AuthBoundaryError("SCHEDULE_REVISION_CONFLICT", 409);
  return dto.scheduledTaskResultDto.parse({ task: projectTask(changed) });
}

function requireBackground(service: ScheduledTaskService) {
  if (!service.backgroundScopes.includes("schedule:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
}
async function claimOne(tx: DataTransaction, serviceId: string) {
  const now = await databaseNow(tx);
  const expired = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), sql`${trigger.status} IN ('claimed','queued','running')`,
    lte(trigger.lease_expires_at, sql`CURRENT_TIMESTAMP`)
  )).orderBy(asc(trigger.created_at)).limit(1).for("update", { skipLocked: true, of: trigger }))[0];
  if (expired) {
    await reconcileOne(tx, { id: serviceId, backgroundScopes: ["schedule:execute"] }, expired.chat_scheduled_trigger.id);
  }
  const unclaimed = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), eq(trigger.status, "claimed"), isNull(trigger.claim_id)
  )).orderBy(asc(trigger.created_at)).limit(1).for("update", { skipLocked: true, of: trigger }))[0];
  if (unclaimed) {
    if (["paused", "deleted"].includes(unclaimed.chat_scheduled_task.status)) {
      await tx.update(trigger).set({ status: "skipped", error_code: "SCHEDULE_INACTIVE_BEFORE_CLAIM",
        lease_expires_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(trigger.id, unclaimed.chat_scheduled_trigger.id));
    } else {
      const claimId = randomUUID();
      const claimed = (await tx.update(trigger).set({ claim_id: claimId, lease_expires_at: new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000).toISOString(), updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(trigger.id, unclaimed.chat_scheduled_trigger.id), isNull(trigger.claim_id))).returning())[0]!;
      return { trigger: projectTrigger(claimed), claim_id: claimId };
    }
  }
  const due = (await tx.select().from(task).where(and(eq(task.service_client_id, serviceId), eq(task.status, "active"), lte(task.next_run_at, sql`CURRENT_TIMESTAMP`))).orderBy(asc(task.next_run_at)).limit(1).for("update", { skipLocked: true }))[0];
  if (!due || !due.next_run_at) return { trigger: null, claim_id: null };
  const scheduledAt = due.schedule_kind === "daily" ? latestDailyInstant(now, due.local_time, due.time_zone) : new Date(due.next_run_at);
  const next = due.schedule_kind === "daily" ? nextDailyInstant(now, due.local_time, due.time_zone).toISOString() : null;
  const futureStatus = due.schedule_kind === "daily" ? "active" : "exhausted";
  const open = await new ScheduledTaskRepository(tx).open(due.id);
  if (open) {
    await tx.update(trigger).set({ skipped_from_at: due.next_run_at, skipped_through_at: scheduledAt.toISOString(), updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, open.id));
    await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
    return { trigger: null, claim_id: null };
  }
  const claimId = randomUUID();
  const skippedThrough = due.schedule_kind === "daily" && new Date(due.next_run_at) < scheduledAt
    ? latestDailyInstant(new Date(scheduledAt.getTime() - 1), due.local_time, due.time_zone).toISOString() : null;
  const created = (await tx.insert(trigger).values({ id: randomUUID(), task_id: due.id, user_id: due.user_id,
    kind: "scheduled", scheduled_at: scheduledAt.toISOString(), definition_revision: due.revision,
    title_snapshot: due.title, prompt_snapshot: due.prompt, source_thread_id: due.source_thread_id,
    time_zone_snapshot: due.time_zone, status: "claimed", claim_id: claimId,
    lease_expires_at: new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000).toISOString(),
    skipped_from_at: skippedThrough ? due.next_run_at : null, skipped_through_at: skippedThrough }).returning())[0]!;
  await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
  return { trigger: projectTrigger(created), claim_id: claimId };
}
async function prepareOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.prepareScheduledTriggerInputDto>) {
  const store = new ScheduledTaskRepository(tx);
  const current = await store.trigger(input.trigger_id, true);
  if (!current || current.claim_id !== input.claim_id || !["claimed", "queued"].includes(current.status)) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  const definition = await store.serviceTask(current.task_id, service.id);
  if (!definition || current.user_id !== definition.user_id || current.source_thread_id !== definition.source_thread_id) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  const now = await databaseNow(tx);
  if (!current.lease_expires_at || new Date(current.lease_expires_at) <= now) throw new AuthBoundaryError("SCHEDULE_CLAIM_EXPIRED", 409);
  const identity = await new SubjectRepository(tx).findActive(definition.auth_user_id);
  if (!identity || String(identity.canonicalUserId) !== String(definition.user_id)) {
    const failed = (await tx.update(trigger).set({ status: "failed", error_code: "ACTIVE_SUBJECT_REQUIRED", lease_expires_at: null, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, current.id)).returning())[0]!;
    return dto.prepareScheduledTriggerResultDto.parse({ prepared: false, trigger: projectTrigger(failed), error_code: "ACTIVE_SUBJECT_REQUIRED" });
  }
  const threads = new ChatThreadRepository(tx, String(definition.user_id));
  let taskSession;
  try {
    await threads.requireOwned(current.source_thread_id);
    taskSession = await threads.createTaskSession(taskSessionCreateInputDto.parse({
      source_thread_id: current.source_thread_id, request_key: current.id,
      title: current.title_snapshot, initial_message: current.prompt_snapshot,
      source_message_id: null, expected_revision: null,
    }));
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    const safe = ["CHAT_THREAD_NOT_FOUND", "DECK_ACCESS_DENIED", "DECK_DISABLED", "AGENT_ACCESS_DENIED"].includes(error.code) ? error.code : "SCHEDULE_PREPARE_DENIED";
    const failed = (await tx.update(trigger).set({ status: "failed", error_code: safe, lease_expires_at: null, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, current.id)).returning())[0]!;
    return dto.prepareScheduledTriggerResultDto.parse({ prepared: false, trigger: projectTrigger(failed), error_code: safe });
  }
  const prepared = (await tx.update(trigger).set({ status: "queued", task_session_id: taskSession.task_id,
    target_thread_id: taskSession.thread_id, input_message_id: taskSession.initial_message_id,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(trigger.id, current.id), eq(trigger.claim_id, input.claim_id))).returning())[0]!;
  const expires = new Date(prepared.lease_expires_at!).getTime();
  const authorityToken = issueScheduledChatAuthority({ trigger_id: current.id, claim_id: input.claim_id,
    service_client_id: service.id, auth_user_id: definition.auth_user_id, user_id: String(definition.user_id),
    source_thread_id: current.source_thread_id, target_thread_id: taskSession.thread_id,
    issued_at: now.getTime(), expires_at: expires });
  return dto.prepareScheduledTriggerResultDto.parse({ prepared: true, trigger: projectTrigger(prepared), task_session: taskSession,
    authority_token: authorityToken, authority_expires_at: new Date(expires).toISOString() });
}
async function renewOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.renewScheduledTriggerInputDto>) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(input.trigger_id, true);
  if (!row || row.claim_id !== input.claim_id || !["queued", "running"].includes(row.status) || !row.target_thread_id) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  const definition = await store.serviceTask(row.task_id, service.id);
  const now = await databaseNow(tx);
  if (!definition || !row.lease_expires_at || new Date(row.lease_expires_at) <= now) throw new AuthBoundaryError("SCHEDULE_CLAIM_EXPIRED", 409);
  await resolveScheduledChatClaim(tx, { triggerId: row.id, claimId: input.claim_id,
    serviceId: service.id, authUserId: definition.auth_user_id, userId: String(definition.user_id),
    targetThreadId: row.target_thread_id, maximumExpiresAt: new Date(row.lease_expires_at) });
  const expiry = new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000);
  const renewed = (await tx.update(trigger).set({ lease_expires_at: expiry.toISOString(), updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  const token = issueScheduledChatAuthority({ trigger_id: row.id, claim_id: input.claim_id, service_client_id: service.id,
    auth_user_id: definition.auth_user_id, user_id: String(definition.user_id), source_thread_id: row.source_thread_id,
    target_thread_id: row.target_thread_id, issued_at: now.getTime(), expires_at: expiry.getTime() });
  return dto.renewScheduledTriggerResultDto.parse({ trigger: projectTrigger(renewed), authority_token: token, authority_expires_at: expiry.toISOString() });
}
async function startOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.startScheduledTriggerInputDto>) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(input.trigger_id, true);
  if (!row || row.claim_id !== input.claim_id || !row.target_thread_id || !row.task_session_id
    || !["queued", "running"].includes(row.status)) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  const definition = await store.serviceTask(row.task_id, service.id);
  if (!definition || !row.lease_expires_at) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  await resolveScheduledChatClaim(tx, { triggerId: row.id, claimId: input.claim_id,
    serviceId: service.id, authUserId: definition.auth_user_id, userId: String(definition.user_id),
    targetThreadId: row.target_thread_id, maximumExpiresAt: new Date(row.lease_expires_at) });
  if (row.target_turn_id !== null && row.target_turn_id !== input.target_turn_id) throw new AuthBoundaryError("SCHEDULE_TURN_CONFLICT", 409);
  if (row.status === "running") return dto.startScheduledTriggerResultDto.parse({ trigger: projectTrigger(row) });
  const started = (await tx.update(trigger).set({ status: "running", target_turn_id: input.target_turn_id,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return dto.startScheduledTriggerResultDto.parse({ trigger: projectTrigger(started) });
}
async function finishOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.finishScheduledTriggerInputDto>) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(input.trigger_id, true);
  if (!row || row.claim_id !== input.claim_id || !await store.serviceTask(row.task_id, service.id)) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  if (!["claimed", "queued", "running", "state_unknown"].includes(row.status)) throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
  if (row.status === "claimed" && input.status !== "failed") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
  if (input.status === "state_unknown" && row.target_turn_id === null) throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
  if (input.status === "succeeded") {
    if (!["running", "state_unknown"].includes(row.status) || !row.target_thread_id || !row.target_turn_id || !input.final_message_id || input.error_code !== null) throw new AuthBoundaryError("SCHEDULE_FINAL_INVALID", 400);
    const final = (await tx.select({ id: message.id, role: message.role, projection: message.history_projection_version,
      metadata: message.metadata }).from(message).where(and(eq(message.id, input.final_message_id), eq(message.thread_id, row.target_thread_id))).limit(1))[0];
    if (!final || final.role !== "assistant" || final.projection !== 1
      || !isCompletedTurn(final.metadata, row.target_turn_id)) throw new AuthBoundaryError("SCHEDULE_FINAL_INVALID", 409);
  } else if (input.final_message_id !== null) throw new AuthBoundaryError("SCHEDULE_FINAL_INVALID", 400);
  if (input.status === "failed" && input.error_code === null || !["failed", "state_unknown"].includes(input.status) && input.error_code !== null) throw new AuthBoundaryError("SCHEDULE_ERROR_INVALID", 400);
  const updated = (await tx.update(trigger).set({ status: input.status, final_message_id: input.final_message_id,
    error_code: input.error_code, lease_expires_at: null,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return dto.finishScheduledTriggerResultDto.parse({ trigger: projectTrigger(updated) });
}
async function reconcileOne(tx: DataTransaction, service: ScheduledTaskService, triggerId: string) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(triggerId, true);
  if (!row || !await store.serviceTask(row.task_id, service.id)) throw new AuthBoundaryError("SCHEDULE_TRIGGER_NOT_FOUND", 404);
  if (!["claimed", "queued", "running", "state_unknown"].includes(row.status)) return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(row) });
  const now = await databaseNow(tx);
  if (row.status !== "state_unknown" && (!row.lease_expires_at || new Date(row.lease_expires_at) > now)) return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(row) });
  if (row.target_thread_id && row.target_turn_id) {
      const candidates = await tx.select({ id: message.id, metadata: message.metadata }).from(message).where(and(
        eq(message.thread_id, row.target_thread_id), eq(message.role, "assistant"),
        eq(message.history_projection_version, 1),
      ));
      const final = candidates.find(candidate => isCompletedTurn(candidate.metadata, row.target_turn_id));
      if (final) {
        const succeeded = (await tx.update(trigger).set({ status: "succeeded", final_message_id: final.id,
          lease_expires_at: null, error_code: null, updated_at: sql`CURRENT_TIMESTAMP` })
          .where(eq(trigger.id, row.id)).returning())[0]!;
        return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(succeeded) });
      }
  }
  // A bound turn is the first point at which the model may have run. Before start,
  // the same TaskSession and input can be prepared again under a new claim.
  if (row.target_turn_id === null) {
    const retryable = (await tx.update(trigger).set({ status: "claimed", claim_id: null,
      lease_expires_at: null, error_code: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(trigger.id, row.id)).returning())[0]!;
    return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(retryable) });
  }
  // An expired bound turn may have reached the model despite lost transport.
  if (row.status === "state_unknown") return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(row) });
  const updated = (await tx.update(trigger).set({ status: "state_unknown",
    lease_expires_at: null, error_code: "SCHEDULE_RESULT_UNKNOWN",
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return dto.reconcileScheduledTriggerResultDto.parse({ trigger: projectTrigger(updated) });
}
export async function runChatScheduledBackgroundOperation(name: dto.ChatScheduledBackgroundOperation, raw: unknown, service: ScheduledTaskService, tx: DataTransaction) {
  requireBackground(service);
  const contract = dto.chatScheduledTaskOperationContracts[name], parsed = contract.input.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  if (name === "scheduled-trigger.claim") return dto.claimScheduledTriggerResultDto.parse(await claimOne(tx, service.id));
  if (name === "scheduled-trigger.prepare") return prepareOne(tx, service, dto.prepareScheduledTriggerInputDto.parse(parsed.data));
  if (name === "scheduled-trigger.renew") return renewOne(tx, service, dto.renewScheduledTriggerInputDto.parse(parsed.data));
  if (name === "scheduled-trigger.start") return startOne(tx, service, dto.startScheduledTriggerInputDto.parse(parsed.data));
  if (name === "scheduled-trigger.finish") return finishOne(tx, service, dto.finishScheduledTriggerInputDto.parse(parsed.data));
  if (name === "scheduled-trigger.reconcile") return reconcileOne(tx, service, dto.reconcileScheduledTriggerInputDto.parse(parsed.data).trigger_id);
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}
