// [Input] Immutable v1/v2 plus v3 recurrence/Thread/model DTOs, verified actor or scoped service, and capability-gated transactions.
// [Output] Owner-filtered definitions, fenced dispatch/reconcile claims, source/new Thread preparation, and immutable model snapshots.
// [Pos] Admin scheduled Chat domain service and repository boundary; Dream owns the shared Chat runtime and model admission.
// [Sync] 2026-10-07: read scheduled activity for an owned source or execution Thread without date filtering or writes.
// [Sync] 2026-10-07: add v3 canonical recurrence, source/new Thread execution and model snapshots while preserving v1/v2 hashes.
// [Sync] 2026-10-07: keep the inserted trigger reference const for the repository lint contract; no dispatch behavior changes.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { chat_scheduled_task as task, chat_scheduled_trigger as trigger, chat_message as message, user_sessions } from "@ink-memory/db/schema/dream";
import { chatScheduledTaskPolicy } from "../../../config/chat-scheduled-task-policy";
import { AuthBoundaryError, type DreamServiceClient } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import { SubjectRepository } from "../auth/subjectRepository";
import type { DataTransaction, SchemaRequirement } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";
import { chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { pgTimestampToIso, taskSessionCreateInputDto } from "./chatThreadDto";
import { addLocalDays, canonicalRecurringRrule, latestDailyInstant, localDayBounds, nextDailyInstant, nextRecurringInstant,
  onceInstant, recurringDue, structuredRuleFromRrule, utcCandidates } from "./chatScheduledTaskTime";
import { issueScheduledChatAuthority, resolveScheduledChatClaim } from "./chatScheduledTaskAuthority";
import * as dto from "./chatScheduledTaskDto";
import scheduleContract from "../../../drizzle/contracts/dream-chat-scheduled-task-v1.json";
import scheduleV2Contract from "../../../drizzle/contracts/dream-chat-scheduled-task-v2.json";
import scheduleV3Contract from "../../../drizzle/contracts/dream-chat-scheduled-task-v3.json";
import turnBindingContract from "../../../drizzle/contracts/dream-chat-scheduled-turn-binding-v1.json";
import linkLifecycleContract from "../../../drizzle/contracts/dream-chat-scheduled-link-lifecycle-v1.json";

export const chatScheduledTaskSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-task.v1", version: 1, contractSha256: scheduleContract.contract_sha256 };
export const chatScheduledTaskV2SchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-task.v2", version: 2, contractSha256: scheduleV2Contract.contract_sha256 };
export const chatScheduledTaskV3SchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-task.v3", version: 3, contractSha256: scheduleV3Contract.contract_sha256 };
export const chatScheduledTurnBindingSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-turn-binding.v1", version: 1, contractSha256: turnBindingContract.contract_sha256 };
export const chatScheduledLinkLifecycleSchemaRequirement: SchemaRequirement = { capability: "dream.chat-scheduled-link-lifecycle.v1", version: 1, contractSha256: linkLifecycleContract.contract_sha256 };
export const chatScheduledTaskSchemaRequirements = [dreamUnifiedSchemaRequirement, chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, chatScheduledTaskSchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement] as const;
export const chatScheduledTaskV2SchemaRequirements = [dreamUnifiedSchemaRequirement, chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, chatScheduledTaskV2SchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement] as const;
export const chatScheduledTaskV3SchemaRequirements = [dreamUnifiedSchemaRequirement, chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement, chatScheduledTaskV3SchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement] as const;
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
function taskRuleV2(row: TaskRow) {
  if (row.schedule_kind === "interval") return dto.scheduledRuleV2Dto.parse({ kind: "interval", interval_minutes: row.interval_minutes, time_zone: row.time_zone });
  return dto.scheduledRuleV2Dto.parse(taskRule(row));
}
function taskRuleV3(row: TaskRow) {
  if (row.schedule_kind === "rrule") return dto.scheduledRuleV3Dto.parse(structuredRuleFromRrule(row.rrule!, row.time_zone));
  return dto.scheduledRuleV3Dto.parse(taskRuleV2(row));
}
function sameCreateRule(row: TaskRow, rule: z.infer<typeof dto.scheduledRuleDto>) {
  if (row.schedule_kind !== rule.kind || row.local_time !== rule.local_time || row.time_zone !== rule.time_zone) return false;
  if (rule.kind === "daily") return true;
  if (row.local_date !== rule.local_date) return false;
  return row.single_offset_minutes === onceInstant(rule.local_date, rule.local_time, rule.time_zone, rule.selected_offset_minutes).offsetMinutes;
}
function sameCreateRuleV2(row: TaskRow, rule: z.infer<typeof dto.scheduledRuleV2Dto>) {
  if (rule.kind === "interval") return row.schedule_kind === "interval"
    && row.interval_minutes === rule.interval_minutes && row.time_zone === rule.time_zone;
  return row.target_editor_session_id === null && sameCreateRule(row, rule);
}
function sameCreateRuleV3(row: TaskRow, rule: z.infer<typeof dto.scheduledRuleV3Dto>) {
  if (rule.kind === "hourly" || rule.kind === "weekly") {
    return row.schedule_kind === "rrule" && row.time_zone === rule.time_zone
      && row.rrule === canonicalRecurringRrule(rule);
  }
  return sameCreateRuleV2(row, rule);
}
function projectTask(row: TaskRow) {
  return dto.scheduledTaskDto.parse({ id: row.id, source_thread_id: row.source_thread_id, title: row.title, prompt: row.prompt,
    rule: taskRule(row), next_run_at: instant(row.next_run_at), status: row.status, revision: row.revision,
    created_at: instant(row.created_at), updated_at: instant(row.updated_at) });
}
function projectTaskV2(row: TaskRow) {
  return dto.scheduledTaskV2Dto.parse({ id: row.id, source_thread_id: row.source_thread_id, title: row.title, prompt: row.prompt,
    rule: taskRuleV2(row), next_run_at: instant(row.next_run_at), status: row.status, revision: row.revision,
    created_at: instant(row.created_at), updated_at: instant(row.updated_at) });
}
function projectTaskV3(row: TaskRow) {
  return dto.scheduledTaskV3Dto.parse({ id: row.id, source_thread_id: row.source_thread_id, title: row.title, prompt: row.prompt,
    rule: taskRuleV3(row), next_run_at: instant(row.next_run_at), status: row.status, revision: row.revision,
    run_thread_mode: row.run_thread_mode, model_alias: row.model_alias,
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
function projectTriggerV3(row: TriggerRow) {
  return dto.scheduledTriggerV3Dto.parse({ ...projectTrigger(row),
    run_thread_mode_snapshot: row.run_thread_mode_snapshot, model_alias_snapshot: row.model_alias_snapshot });
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
function planV2(rule: z.infer<typeof dto.scheduledRuleV2Dto>, now: Date) {
  if (rule.kind === "interval") return {
    next: new Date(now.getTime() + rule.interval_minutes * 60_000).toISOString(), offset: null,
  };
  return plan(rule, now);
}
function planV3(rule: z.infer<typeof dto.scheduledRuleV3Dto>, now: Date) {
  if (rule.kind === "hourly" || rule.kind === "weekly") {
    const rrule = canonicalRecurringRrule(rule);
    return { next: nextRecurringInstant(now, rrule, rule.time_zone).toISOString(), offset: null, rrule };
  }
  return { ...planV2(rule, now), rrule: null };
}
function intervalDue(now: Date, nextRunAt: string, intervalMinutes: number) {
  const first = new Date(nextRunAt).getTime();
  const step = intervalMinutes * 60_000;
  const elapsed = Math.max(0, now.getTime() - first);
  const periods = Math.floor(elapsed / step);
  const scheduledAt = new Date(first + periods * step);
  return { scheduledAt, next: new Date(scheduledAt.getTime() + step) };
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
  async openSourceThread(threadId: string) {
    return (await this.tx.select().from(trigger).where(and(
      eq(trigger.target_thread_id, threadId), eq(trigger.run_thread_mode_snapshot, "source_thread"),
      sql`${trigger.status} IN ('claimed','queued','running','state_unknown')`,
    )).limit(1))[0] ?? null;
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
  if (row.schedule_kind === "interval") return new Date(now.getTime() + row.interval_minutes! * 60_000).toISOString();
  if (row.schedule_kind === "daily") return nextDailyInstant(now, row.local_time, row.time_zone).toISOString();
  if (row.schedule_kind === "rrule") return nextRecurringInstant(now, row.rrule!, row.time_zone).toISOString();
  if (row.status_before_delete === "exhausted") return null;
  const date = row.local_date!;
  const candidate = onceInstant(date, row.local_time, row.time_zone, row.single_offset_minutes);
  return candidate.instant > now ? candidate.instant.toISOString() : null;
}
async function editorTargetOwned(tx: DataTransaction, userId: string, editorSessionId: string | null) {
  if (editorSessionId === null) return true;
  const owned = (await tx.select({ id: user_sessions.id }).from(user_sessions).where(and(
    eq(user_sessions.id, editorSessionId), eq(user_sessions.user_id, sql`${userId}::bigint`),
  )).for("share").limit(1))[0];
  return !!owned;
}

function versionedOperationName(name: string, version: 2 | 3) {
  const [prefix, action] = name.split(".");
  return `${prefix}.v${version}.${action}`;
}
function taskForVersion(row: TaskRow, version: 1 | 2 | 3) {
  return version === 1 ? projectTask(row) : version === 2 ? projectTaskV2(row) : projectTaskV3(row);
}
function triggerForVersion(row: TriggerRow, version: 1 | 2 | 3) {
  return version === 3 ? projectTriggerV3(row) : projectTrigger(row);
}
async function runChatScheduledUserOperationCommon(name: dto.ChatScheduledUserOperation, raw: unknown, actor: ScheduledTaskActor, tx: DataTransaction, serviceId: string, version: 1 | 2 | 3) {
  const contract = version === 1 ? dto.chatScheduledTaskOperationContracts[name]
    : version === 2 ? dto.chatScheduledTaskV2OperationContracts[versionedOperationName(name, 2) as dto.ChatScheduledUserV2Operation]
      : dto.chatScheduledTaskV3OperationContracts[versionedOperationName(name, 3) as dto.ChatScheduledUserV3Operation];
  const parsed = contract.input.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = assertUser(actor, contract.userScope);
  if (actor.threadScope !== null && name !== "scheduled-task.create") throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
  await currentIdentity(tx, principal);
  const store = new ScheduledTaskRepository(tx, principal.canonical_user_id);
  const now = await databaseNow(tx);
  if (name === "scheduled-task.create") {
    const input = version === 1 ? dto.createScheduledTaskInputDto.parse(parsed.data)
      : version === 2 ? dto.createScheduledTaskV2InputDto.parse(parsed.data) : dto.createScheduledTaskV3InputDto.parse(parsed.data);
    const inputV3 = version === 3 ? dto.createScheduledTaskV3InputDto.parse(parsed.data) : null;
    if (actor.threadScope !== null && actor.threadScope !== input.source_thread_id) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    await sourceOwned(tx, principal.canonical_user_id, input.source_thread_id);
    const existing = (await tx.select().from(task).where(and(eq(task.service_client_id, serviceId), eq(task.auth_user_id, principal.subject), eq(task.create_request_key, input.create_request_key))).limit(1))[0];
    const targetEditorSessionId = version >= 2 && "target_editor_session_id" in input ? input.target_editor_session_id : null;
    if (!await editorTargetOwned(tx, principal.canonical_user_id, targetEditorSessionId)) throw new AuthBoundaryError("SCHEDULE_EDITOR_TARGET_NOT_FOUND", 404);
    if (existing) {
      if (existing.source_thread_id !== input.source_thread_id || existing.title !== input.title || existing.prompt !== input.prompt
        || existing.target_editor_session_id !== targetEditorSessionId
        || (version === 1 ? !sameCreateRule(existing, input.rule as z.infer<typeof dto.scheduledRuleDto>)
          : version === 2 ? !sameCreateRuleV2(existing, input.rule as z.infer<typeof dto.scheduledRuleV2Dto>)
            : !sameCreateRuleV3(existing, input.rule as z.infer<typeof dto.scheduledRuleV3Dto>))
        || (inputV3 !== null && (existing.run_thread_mode !== inputV3.run_thread_mode || existing.model_alias !== inputV3.model_alias))) {
        throw new AuthBoundaryError("SCHEDULE_CREATE_IDENTITY_CONFLICT", 409);
      }
      return { task: taskForVersion(existing, version) };
    }
    const schedule = version === 1 ? plan(input.rule as z.infer<typeof dto.scheduledRuleDto>, now)
      : version === 2 ? planV2(input.rule as z.infer<typeof dto.scheduledRuleV2Dto>, now)
        : planV3(input.rule as z.infer<typeof dto.scheduledRuleV3Dto>, now);
    const rule = input.rule as z.infer<typeof dto.scheduledRuleV3Dto>;
    const recurring = rule.kind === "hourly" || rule.kind === "weekly";
    const row = (await tx.insert(task).values({ id: randomUUID(), user_id: Number(principal.canonical_user_id),
      auth_user_id: principal.subject, service_client_id: serviceId, source_thread_id: input.source_thread_id,
      create_request_key: input.create_request_key, title: input.title, prompt: input.prompt,
      schedule_kind: recurring ? "rrule" : rule.kind, time_zone: rule.time_zone,
      local_date: rule.kind === "once" ? rule.local_date : null,
      local_time: rule.kind === "once" || rule.kind === "daily" ? rule.local_time : null,
      single_offset_minutes: schedule.offset, interval_minutes: rule.kind === "interval" ? rule.interval_minutes : null,
      rrule: "rrule" in schedule ? schedule.rrule : null,
      run_thread_mode: inputV3?.run_thread_mode ?? "new_thread_each_run",
      model_alias: inputV3?.model_alias ?? null,
      target_editor_session_id: targetEditorSessionId, next_run_at: schedule.next, status: "active" }).returning())[0]!;
    return { task: taskForVersion(row, version) };
  }
  if (name === "scheduled-task.day") {
    const input = dto.dayScheduledTaskInputDto.parse(parsed.data);
    const bounds = localDayBounds(input.local_date, input.display_time_zone);
    const rows = await tx.select().from(task).where(eq(task.user_id, sql`${principal.canonical_user_id}::bigint`));
    const matching = rows.filter(row => {
      if (version === 1 && (row.schedule_kind === "interval" || row.schedule_kind === "rrule" || row.target_editor_session_id !== null)) return false;
      if (version === 2 && row.schedule_kind === "rrule") return false;
      if (new Date(row.created_at) >= bounds.until) return false;
      if (row.schedule_kind === "once") {
        const candidate = onceInstant(row.local_date!, row.local_time, row.time_zone, row.single_offset_minutes).instant;
        return candidate >= bounds.from && candidate < bounds.until;
      }
      if (row.schedule_kind === "interval") {
        return row.next_run_at !== null && new Date(row.next_run_at) >= bounds.from && new Date(row.next_run_at) < bounds.until;
      }
      if (row.schedule_kind === "rrule") {
        const candidate = row.next_run_at === null ? null : new Date(row.next_run_at);
        return candidate !== null && candidate >= bounds.from && candidate < bounds.until;
      }
      for (let day = -1; day <= 1; day++) {
        const sourceDate = addLocalDays(input.local_date, day);
        const candidate = utcCandidates(sourceDate, row.local_time!, row.time_zone)[0]?.instant;
        if (candidate && candidate >= bounds.from && candidate < bounds.until) return true;
      }
      return false;
    });
    const triggers = await tx.select().from(trigger).where(and(eq(trigger.user_id, sql`${principal.canonical_user_id}::bigint`), or(
      and(eq(trigger.kind, "scheduled"), gte(trigger.scheduled_at, bounds.from.toISOString()), lt(trigger.scheduled_at, bounds.until.toISOString())),
      and(eq(trigger.kind, "manual"), gte(trigger.created_at, bounds.from.toISOString()), lt(trigger.created_at, bounds.until.toISOString())),
    ))).orderBy(asc(sql`COALESCE(${trigger.scheduled_at}, ${trigger.created_at})`), asc(trigger.id));
    return { tasks: matching.map(item => taskForVersion(item, version)), triggers: triggers.map(item => triggerForVersion(item, version)) };
  }
  const input = dto.scheduledTaskIdInputDto.parse({ task_id: (parsed.data as { task_id: string }).task_id });
  const row = await store.owned(input.task_id, contract.kind === "write");
  if (!row) {
    if (name === "scheduled-task.get") return { task: null };
    throw new AuthBoundaryError("SCHEDULE_TASK_NOT_FOUND", 404);
  }
  if (version === 1 && (row.schedule_kind === "interval" || row.target_editor_session_id !== null)) {
    if (name === "scheduled-task.get") return dto.scheduledTaskNullableResultDto.parse({ task: null });
    throw new AuthBoundaryError("SCHEDULE_TASK_NOT_FOUND", 404);
  }
  if (version === 2 && row.schedule_kind === "rrule") {
    if (name === "scheduled-task.get") return { task: null };
    throw new AuthBoundaryError("SCHEDULE_TASK_NOT_FOUND", 404);
  }
  await sourceOwned(tx, principal.canonical_user_id, row.source_thread_id);
  if (name === "scheduled-task.get") return { task: taskForVersion(row, version) };
  if (name === "scheduled-task.history") {
    const value = dto.historyScheduledTaskInputDto.parse(parsed.data);
    if (value.limit > chatScheduledTaskPolicy.historyPageMaximum) throw new AuthBoundaryError("SCHEDULE_HISTORY_LIMIT", 400);
    const history = await tx.select().from(trigger).where(and(eq(trigger.task_id, row.id), value.before_created_at ? lt(trigger.created_at, value.before_created_at) : undefined)).orderBy(desc(trigger.created_at), desc(trigger.id)).limit(value.limit);
    return { triggers: history.map(item => triggerForVersion(item, version)) };
  }
  if (name === "scheduled-task.run") {
    const value = dto.runScheduledTaskInputDto.parse(parsed.data);
    if (!["active", "exhausted"].includes(row.status)) throw new AuthBoundaryError("SCHEDULE_TASK_INACTIVE", 409);
    const previous = (await tx.select().from(trigger).where(and(eq(trigger.task_id, row.id), eq(trigger.kind, "manual"), eq(trigger.manual_request_key, value.manual_request_key))).limit(1))[0];
    if (previous) return { trigger: triggerForVersion(previous, version) };
    const open = await store.open(row.id);
    if (open) return { trigger: triggerForVersion(open, version) };
    if (version === 3 && row.run_thread_mode === "source_thread" && await store.openSourceThread(row.source_thread_id)) {
      const failed = (await tx.insert(trigger).values({ id: randomUUID(), task_id: row.id, user_id: row.user_id,
        kind: "manual", manual_request_key: value.manual_request_key, definition_revision: row.revision,
        title_snapshot: row.title, prompt_snapshot: row.prompt, source_thread_id: row.source_thread_id,
        time_zone_snapshot: row.time_zone, target_editor_session_id_snapshot: row.target_editor_session_id,
        run_thread_mode_snapshot: row.run_thread_mode, model_alias_snapshot: row.model_alias,
        target_thread_id: row.source_thread_id, status: "failed", error_code: "SCHEDULE_SOURCE_THREAD_BUSY",
      }).returning())[0]!;
      return { trigger: projectTriggerV3(failed) };
    }
    const triggerValues = { id: randomUUID(), task_id: row.id, user_id: row.user_id,
      kind: "manual", manual_request_key: value.manual_request_key, definition_revision: row.revision,
      title_snapshot: row.title, prompt_snapshot: row.prompt, source_thread_id: row.source_thread_id,
      time_zone_snapshot: row.time_zone, target_editor_session_id_snapshot: row.target_editor_session_id,
      run_thread_mode_snapshot: row.run_thread_mode, model_alias_snapshot: row.model_alias,
      target_thread_id: row.run_thread_mode === "source_thread" ? row.source_thread_id : null,
      status: "claimed" };
    let created = (await tx.insert(trigger).values(triggerValues).onConflictDoNothing().returning())[0];
    if (!created && version === 3 && row.run_thread_mode === "source_thread") {
      created = (await tx.insert(trigger).values({ ...triggerValues, id: randomUUID(), status: "failed",
        error_code: "SCHEDULE_SOURCE_THREAD_BUSY" }).returning())[0]!;
    }
    if (!created) throw new AuthBoundaryError("SCHEDULE_TRIGGER_CONFLICT", 409);
    return { trigger: triggerForVersion(created, version) };
  }
  if (!("expected_revision" in parsed.data)) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const change = dto.scheduledTaskRevisionInputDto.parse({ task_id: input.task_id,
    expected_revision: parsed.data.expected_revision });
  requireRevision(row, change.expected_revision);
  if (name === "scheduled-task.edit") {
    if (row.status === "deleted" || row.status === "exhausted") throw new AuthBoundaryError("SCHEDULE_TASK_INACTIVE", 409);
    const value = version === 1 ? dto.editScheduledTaskInputDto.parse(parsed.data)
      : version === 2 ? dto.editScheduledTaskV2InputDto.parse(parsed.data) : dto.editScheduledTaskV3InputDto.parse(parsed.data);
    const valueV3 = version === 3 ? dto.editScheduledTaskV3InputDto.parse(parsed.data) : null;
    const planned = version === 1 ? plan(value.rule as z.infer<typeof dto.scheduledRuleDto>, now)
      : version === 2 ? planV2(value.rule as z.infer<typeof dto.scheduledRuleV2Dto>, now)
        : planV3(value.rule as z.infer<typeof dto.scheduledRuleV3Dto>, now);
    const rule = value.rule as z.infer<typeof dto.scheduledRuleV3Dto>;
    const recurring = rule.kind === "hourly" || rule.kind === "weekly";
    const next = row.status === "paused" ? null : planned.next;
    const changed = (await tx.update(task).set({ title: value.title, prompt: value.prompt,
      schedule_kind: recurring ? "rrule" : rule.kind, time_zone: rule.time_zone, local_date: rule.kind === "once" ? rule.local_date : null,
      local_time: rule.kind === "once" || rule.kind === "daily" ? rule.local_time : null, single_offset_minutes: planned.offset,
      interval_minutes: rule.kind === "interval" ? rule.interval_minutes : null,
      rrule: "rrule" in planned ? planned.rrule : null,
      ...(valueV3 !== null ? { run_thread_mode: valueV3.run_thread_mode, model_alias: valueV3.model_alias } : {}), next_run_at: next,
      revision: row.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(task.id, row.id), eq(task.revision, row.revision))).returning())[0];
    if (!changed) throw new AuthBoundaryError("SCHEDULE_REVISION_CONFLICT", 409);
    return { task: taskForVersion(changed, version) };
  }
  let status = row.status, before = row.status_before_delete, next = row.next_run_at;
  if (name === "scheduled-task.pause") {
    if (status !== "active") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    status = "paused"; next = null;
  } else if (name === "scheduled-task.resume") {
    if (status !== "paused") throw new AuthBoundaryError("SCHEDULE_TRANSITION_INVALID", 409);
    next = row.schedule_kind === "daily" ? nextDailyInstant(now, row.local_time!, row.time_zone).toISOString() : nextForRestore({ ...row, status_before_delete: "active" }, now);
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
  return { task: taskForVersion(changed, version) };
}

export function runChatScheduledUserOperation(name: dto.ChatScheduledUserOperation, raw: unknown, actor: ScheduledTaskActor, tx: DataTransaction, serviceId: string) {
  return runChatScheduledUserOperationCommon(name, raw, actor, tx, serviceId, 1);
}
export async function runChatScheduledUserV2Operation(name: dto.ChatScheduledUserV2Operation, raw: unknown, actor: ScheduledTaskActor, tx: DataTransaction, serviceId: string) {
  if (name === "scheduled-task.v2.thread") {
    const parsed = dto.scheduledTaskThreadInputDto.safeParse(raw);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    const principal = assertUser(actor, "dream:read");
    if (actor.threadScope !== null) throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
    await currentIdentity(tx, principal);
    await sourceOwned(tx, principal.canonical_user_id, parsed.data.thread_id);
    const created = await tx.select().from(task).where(and(
      eq(task.user_id, sql`${principal.canonical_user_id}::bigint`),
      eq(task.source_thread_id, parsed.data.thread_id),
    )).orderBy(asc(task.created_at), asc(task.id));
    const source = (await tx.select({ task, trigger }).from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
      eq(trigger.target_thread_id, parsed.data.thread_id),
      eq(trigger.user_id, sql`${principal.canonical_user_id}::bigint`),
      eq(task.user_id, sql`${principal.canonical_user_id}::bigint`),
    )).limit(1))[0];
    return dto.scheduledTaskThreadResultDto.parse({
      created: created.map(projectTaskV2),
      source: source ? { task: projectTaskV2(source.task), trigger: projectTrigger(source.trigger) } : null,
    });
  }
  const baseName = name.replace(".v2.", ".") as dto.ChatScheduledUserOperation;
  return runChatScheduledUserOperationCommon(baseName, raw, actor, tx, serviceId, 2);
}

export async function runChatScheduledUserV3Operation(name: dto.ChatScheduledUserV3Operation, raw: unknown, actor: ScheduledTaskActor, tx: DataTransaction, serviceId: string) {
  if (name === "scheduled-task.v3.thread") {
    const parsed = dto.scheduledTaskThreadInputDto.safeParse(raw);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    const principal = assertUser(actor, "dream:read");
    if (actor.threadScope !== null) throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
    await currentIdentity(tx, principal);
    await sourceOwned(tx, principal.canonical_user_id, parsed.data.thread_id);
    const created = await tx.select().from(task).where(and(
      eq(task.user_id, sql`${principal.canonical_user_id}::bigint`), eq(task.source_thread_id, parsed.data.thread_id),
    )).orderBy(asc(task.created_at), asc(task.id));
    const source = (await tx.select({ task, trigger }).from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
      eq(trigger.target_thread_id, parsed.data.thread_id), eq(trigger.user_id, sql`${principal.canonical_user_id}::bigint`),
      eq(task.user_id, sql`${principal.canonical_user_id}::bigint`),
    )).orderBy(desc(trigger.created_at), desc(trigger.id)).limit(1))[0];
    return dto.scheduledTaskThreadV3ResultDto.parse({
      created: created.map(projectTaskV3),
      source: source ? { task: projectTaskV3(source.task), trigger: projectTriggerV3(source.trigger) } : null,
    });
  }
  const baseName = name.replace(".v3.", ".") as dto.ChatScheduledUserOperation;
  return runChatScheduledUserOperationCommon(baseName, raw, actor, tx, serviceId, 3);
}

function requireBackground(service: ScheduledTaskService) {
  if (!service.backgroundScopes.includes("schedule:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
}
async function claimOne(tx: DataTransaction, serviceId: string) {
  const now = await databaseNow(tx);
  const expired = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), sql`${trigger.status} IN ('claimed','queued','running')`,
    sql`${task.schedule_kind} IN ('once','daily')`, isNull(task.target_editor_session_id),
    lte(trigger.lease_expires_at, sql`CURRENT_TIMESTAMP`)
  )).orderBy(asc(trigger.created_at)).limit(1).for("update", { skipLocked: true, of: trigger }))[0];
  if (expired) {
    await reconcileOne(tx, { id: serviceId, backgroundScopes: ["schedule:execute"] }, expired.chat_scheduled_trigger.id);
  }
  const unclaimed = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), eq(trigger.status, "claimed"), isNull(trigger.claim_id),
    sql`${task.schedule_kind} IN ('once','daily')`, isNull(task.target_editor_session_id)
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
  const due = (await tx.select().from(task).where(and(eq(task.service_client_id, serviceId), eq(task.status, "active"),
    sql`${task.schedule_kind} IN ('once','daily')`, isNull(task.target_editor_session_id),
    lte(task.next_run_at, sql`CURRENT_TIMESTAMP`))).orderBy(asc(task.next_run_at)).limit(1).for("update", { skipLocked: true }))[0];
  if (!due || !due.next_run_at) return { trigger: null, claim_id: null };
  const scheduledAt = due.schedule_kind === "daily" ? latestDailyInstant(now, due.local_time!, due.time_zone) : new Date(due.next_run_at);
  const next = due.schedule_kind === "daily" ? nextDailyInstant(now, due.local_time!, due.time_zone).toISOString() : null;
  const futureStatus = due.schedule_kind === "daily" ? "active" : "exhausted";
  const open = await new ScheduledTaskRepository(tx).open(due.id);
  if (open) {
    await tx.update(trigger).set({ skipped_from_at: due.next_run_at, skipped_through_at: scheduledAt.toISOString(), updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, open.id));
    await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
    return { trigger: null, claim_id: null };
  }
  const claimId = randomUUID();
  const skippedThrough = due.schedule_kind === "daily" && new Date(due.next_run_at) < scheduledAt
    ? latestDailyInstant(new Date(scheduledAt.getTime() - 1), due.local_time!, due.time_zone).toISOString() : null;
  const created = (await tx.insert(trigger).values({ id: randomUUID(), task_id: due.id, user_id: due.user_id,
    kind: "scheduled", scheduled_at: scheduledAt.toISOString(), definition_revision: due.revision,
    title_snapshot: due.title, prompt_snapshot: due.prompt, source_thread_id: due.source_thread_id,
    time_zone_snapshot: due.time_zone, status: "claimed", claim_id: claimId,
    lease_expires_at: new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000).toISOString(),
    skipped_from_at: skippedThrough ? due.next_run_at : null, skipped_through_at: skippedThrough }).returning())[0]!;
  await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
  return { trigger: projectTrigger(created), claim_id: claimId };
}
async function claimOneV2(tx: DataTransaction, serviceId: string, version: 2 | 3 = 2) {
  const now = await databaseNow(tx);
  const unknown = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), eq(trigger.status, "state_unknown"),
    or(isNull(trigger.unknown_recheck_at), lte(trigger.unknown_recheck_at, sql`CURRENT_TIMESTAMP`)),
  )).orderBy(asc(trigger.unknown_recheck_at), asc(trigger.created_at)).limit(1)
    .for("update", { skipLocked: true, of: trigger }))[0];
  if (unknown) {
    await tx.update(trigger).set({
      unknown_recheck_at: new Date(now.getTime() + chatScheduledTaskPolicy.unknownRecheckSeconds * 1000).toISOString(),
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(trigger.id, unknown.chat_scheduled_trigger.id));
    return { action: "reconcile" as const, trigger_id: unknown.chat_scheduled_trigger.id };
  }
  const expired = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), sql`${trigger.status} IN ('claimed','queued','running')`,
    lte(trigger.lease_expires_at, sql`CURRENT_TIMESTAMP`),
  )).orderBy(asc(trigger.created_at)).limit(1).for("update", { skipLocked: true, of: trigger }))[0];
  if (expired) await reconcileOne(tx, { id: serviceId, backgroundScopes: ["schedule:execute"] }, expired.chat_scheduled_trigger.id, version);

  const unclaimed = (await tx.select().from(trigger).innerJoin(task, eq(trigger.task_id, task.id)).where(and(
    eq(task.service_client_id, serviceId), eq(trigger.status, "claimed"), isNull(trigger.claim_id),
  )).orderBy(asc(trigger.created_at)).limit(1).for("update", { skipLocked: true, of: trigger }))[0];
  if (unclaimed) {
    if (["paused", "deleted"].includes(unclaimed.chat_scheduled_task.status)) {
      await tx.update(trigger).set({ status: "skipped", error_code: "SCHEDULE_INACTIVE_BEFORE_CLAIM",
        lease_expires_at: null, unknown_recheck_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(eq(trigger.id, unclaimed.chat_scheduled_trigger.id));
    } else {
      const claimId = randomUUID();
      const claimed = (await tx.update(trigger).set({ claim_id: claimId,
        lease_expires_at: new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000).toISOString(),
        updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(trigger.id, unclaimed.chat_scheduled_trigger.id), isNull(trigger.claim_id))).returning())[0]!;
      return { action: "dispatch" as const, trigger: triggerForVersion(claimed, version), claim_id: claimId };
    }
  }

  const due = (await tx.select().from(task).where(and(eq(task.service_client_id, serviceId), eq(task.status, "active"),
    lte(task.next_run_at, sql`CURRENT_TIMESTAMP`))).orderBy(asc(task.next_run_at)).limit(1)
    .for("update", { skipLocked: true }))[0];
  if (!due || !due.next_run_at) return { action: "idle" as const };
  let scheduledAt: Date, next: string | null, futureStatus: string, skippedThrough: string | null = null;
  if (due.schedule_kind === "interval") {
    const interval = intervalDue(now, due.next_run_at, due.interval_minutes!);
    scheduledAt = interval.scheduledAt; next = interval.next.toISOString(); futureStatus = "active";
    if (new Date(due.next_run_at) < scheduledAt) skippedThrough = new Date(scheduledAt.getTime() - due.interval_minutes! * 60_000).toISOString();
  } else if (due.schedule_kind === "daily") {
    scheduledAt = latestDailyInstant(now, due.local_time!, due.time_zone);
    next = nextDailyInstant(now, due.local_time!, due.time_zone).toISOString(); futureStatus = "active";
    if (new Date(due.next_run_at) < scheduledAt) skippedThrough = latestDailyInstant(
      new Date(scheduledAt.getTime() - 1), due.local_time!, due.time_zone,
    ).toISOString();
  } else if (due.schedule_kind === "rrule") {
    const recurring = recurringDue(now, due.next_run_at, due.rrule!, due.time_zone);
    scheduledAt = recurring.scheduledAt; next = recurring.next.toISOString(); futureStatus = "active";
    if (new Date(due.next_run_at) < scheduledAt) skippedThrough = new Date(scheduledAt.getTime() - 1).toISOString();
  } else {
    scheduledAt = new Date(due.next_run_at); next = null; futureStatus = "exhausted";
  }
  const open = await new ScheduledTaskRepository(tx).open(due.id);
  if (open) {
    const firstSkipped = [open.skipped_from_at, due.next_run_at].filter((value): value is string => value !== null)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? due.next_run_at;
    const lastSkipped = [open.skipped_through_at, scheduledAt.toISOString()].filter((value): value is string => value !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? scheduledAt.toISOString();
    await tx.update(trigger).set({ skipped_from_at: firstSkipped, skipped_through_at: lastSkipped,
      updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, open.id));
    await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
    return { action: "idle" as const };
  }
  const store = new ScheduledTaskRepository(tx);
  if (version === 3 && due.run_thread_mode === "source_thread" && await store.openSourceThread(due.source_thread_id)) {
    await tx.insert(trigger).values({ id: randomUUID(), task_id: due.id, user_id: due.user_id,
      kind: "scheduled", scheduled_at: scheduledAt.toISOString(), definition_revision: due.revision,
      title_snapshot: due.title, prompt_snapshot: due.prompt, source_thread_id: due.source_thread_id,
      time_zone_snapshot: due.time_zone, target_editor_session_id_snapshot: due.target_editor_session_id,
      run_thread_mode_snapshot: due.run_thread_mode, model_alias_snapshot: due.model_alias,
      target_thread_id: due.source_thread_id, status: "failed", error_code: "SCHEDULE_SOURCE_THREAD_BUSY",
      skipped_from_at: skippedThrough ? due.next_run_at : null, skipped_through_at: skippedThrough,
    });
    await tx.update(task).set({ next_run_at: next, status: futureStatus,
      updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
    return { action: "idle" as const };
  }
  const claimId = randomUUID();
  const triggerValues = { id: randomUUID(), task_id: due.id, user_id: due.user_id,
    kind: "scheduled", scheduled_at: scheduledAt.toISOString(), definition_revision: due.revision,
    title_snapshot: due.title, prompt_snapshot: due.prompt, source_thread_id: due.source_thread_id,
    time_zone_snapshot: due.time_zone, target_editor_session_id_snapshot: due.target_editor_session_id,
    run_thread_mode_snapshot: due.run_thread_mode, model_alias_snapshot: due.model_alias,
    target_thread_id: due.run_thread_mode === "source_thread" ? due.source_thread_id : null,
    status: "claimed", claim_id: claimId,
    lease_expires_at: new Date(now.getTime() + chatScheduledTaskPolicy.claimLeaseSeconds * 1000).toISOString(),
    skipped_from_at: skippedThrough ? due.next_run_at : null, skipped_through_at: skippedThrough };
  const created = (await tx.insert(trigger).values(triggerValues).onConflictDoNothing().returning())[0];
  if (!created && version === 3 && due.run_thread_mode === "source_thread") {
    await tx.insert(trigger).values({ ...triggerValues, id: randomUUID(), status: "failed", claim_id: null,
      lease_expires_at: null, error_code: "SCHEDULE_SOURCE_THREAD_BUSY" });
    await tx.update(task).set({ next_run_at: next, status: futureStatus,
      updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
    return { action: "idle" as const };
  }
  if (!created) return { action: "idle" as const };
  await tx.update(task).set({ next_run_at: next, status: futureStatus, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(task.id, due.id));
  return { action: "dispatch" as const, trigger: triggerForVersion(created, version), claim_id: claimId };
}
async function prepareOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.prepareScheduledTriggerInputDto>, version: 1 | 2 | 3 = 1) {
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
    const output = { prepared: false as const, trigger: triggerForVersion(failed, version), error_code: "ACTIVE_SUBJECT_REQUIRED" };
    return version === 1 ? dto.prepareScheduledTriggerResultDto.parse(output)
      : version === 2 ? dto.prepareScheduledTriggerV2ResultDto.parse(output) : dto.prepareScheduledTriggerV3ResultDto.parse(output);
  }
  if (version >= 2 && !await editorTargetOwned(tx, String(definition.user_id), current.target_editor_session_id_snapshot)) {
    const failed = (await tx.update(trigger).set({ status: "failed", error_code: "SCHEDULE_EDITOR_TARGET_UNAVAILABLE",
      lease_expires_at: null, unknown_recheck_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(trigger.id, current.id)).returning())[0]!;
    const output = { prepared: false as const, trigger: triggerForVersion(failed, version), error_code: "SCHEDULE_EDITOR_TARGET_UNAVAILABLE" };
    return version === 2 ? dto.prepareScheduledTriggerV2ResultDto.parse(output) : dto.prepareScheduledTriggerV3ResultDto.parse(output);
  }
  const threads = new ChatThreadRepository(tx, String(definition.user_id));
  let taskSession: Awaited<ReturnType<ChatThreadRepository["createTaskSession"]>> | null = null;
  let targetThreadId: string;
  let inputMessageId: string;
  try {
    await threads.requireOwned(current.source_thread_id);
    if (version === 3 && current.run_thread_mode_snapshot === "source_thread") {
      targetThreadId = current.source_thread_id;
      inputMessageId = current.input_message_id ?? randomUUID();
      await threads.persistMessage({ thread_id: targetThreadId, message_id: inputMessageId, role: "user",
        parts: [{ type: "text", text: current.prompt_snapshot }],
        metadata: { kind: "scheduled-chat", triggerId: current.id, claimId: input.claim_id },
        history_final_text: null, history_process_available: false, history_projection_version: null });
    } else {
      taskSession = await threads.createTaskSession(taskSessionCreateInputDto.parse({
        source_thread_id: current.source_thread_id, request_key: current.id,
        title: current.title_snapshot, initial_message: current.prompt_snapshot,
        source_message_id: null, expected_revision: null,
      }));
      targetThreadId = taskSession.thread_id;
      inputMessageId = taskSession.initial_message_id;
    }
  } catch (error) {
    if (!(error instanceof AuthBoundaryError)) throw error;
    const safe = ["CHAT_THREAD_NOT_FOUND", "DECK_ACCESS_DENIED", "DECK_DISABLED", "AGENT_ACCESS_DENIED"].includes(error.code) ? error.code : "SCHEDULE_PREPARE_DENIED";
    const failed = (await tx.update(trigger).set({ status: "failed", error_code: safe, lease_expires_at: null, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, current.id)).returning())[0]!;
    const output = { prepared: false as const, trigger: triggerForVersion(failed, version), error_code: safe };
    return version === 1 ? dto.prepareScheduledTriggerResultDto.parse(output)
      : version === 2 ? dto.prepareScheduledTriggerV2ResultDto.parse(output) : dto.prepareScheduledTriggerV3ResultDto.parse(output);
  }
  const prepared = (await tx.update(trigger).set({ status: "queued", task_session_id: taskSession?.task_id ?? null,
    target_thread_id: targetThreadId!, input_message_id: inputMessageId!,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(trigger.id, current.id), eq(trigger.claim_id, input.claim_id))).returning())[0]!;
  const expires = new Date(prepared.lease_expires_at!).getTime();
  const authorityToken = issueScheduledChatAuthority({ trigger_id: current.id, claim_id: input.claim_id,
    service_client_id: service.id, auth_user_id: definition.auth_user_id, user_id: String(definition.user_id),
    source_thread_id: current.source_thread_id, target_thread_id: targetThreadId!,
    issued_at: now.getTime(), expires_at: expires });
  const output = { prepared: true as const, trigger: triggerForVersion(prepared, version), task_session: taskSession,
    authority_token: authorityToken, authority_expires_at: new Date(expires).toISOString() };
  if (version === 1) return dto.prepareScheduledTriggerResultDto.parse({ ...output, task_session: taskSession! });
  if (version === 2) return dto.prepareScheduledTriggerV2ResultDto.parse({ ...output, task_session: taskSession!,
    target_editor_session_id: prepared.target_editor_session_id_snapshot });
  return dto.prepareScheduledTriggerV3ResultDto.parse({ ...output,
    target_thread_id: targetThreadId!, input_message_id: inputMessageId!,
    resume_existing_thread: prepared.run_thread_mode_snapshot === "source_thread",
    model_alias: prepared.model_alias_snapshot, target_editor_session_id: prepared.target_editor_session_id_snapshot });
}
async function renewOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.renewScheduledTriggerInputDto>, version: 1 | 2 | 3 = 1) {
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
  return { trigger: triggerForVersion(renewed, version), authority_token: token, authority_expires_at: expiry.toISOString() };
}
async function startOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.startScheduledTriggerInputDto>, version: 1 | 2 | 3 = 1) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(input.trigger_id, true);
  if (!row || row.claim_id !== input.claim_id || !row.target_thread_id
    || (!row.task_session_id && !(version === 3 && row.run_thread_mode_snapshot === "source_thread"))
    || !["queued", "running"].includes(row.status)) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  const definition = await store.serviceTask(row.task_id, service.id);
  if (!definition || !row.lease_expires_at) throw new AuthBoundaryError("SCHEDULE_CLAIM_INVALID", 409);
  await resolveScheduledChatClaim(tx, { triggerId: row.id, claimId: input.claim_id,
    serviceId: service.id, authUserId: definition.auth_user_id, userId: String(definition.user_id),
    targetThreadId: row.target_thread_id, maximumExpiresAt: new Date(row.lease_expires_at) });
  if (row.target_turn_id !== null && row.target_turn_id !== input.target_turn_id) throw new AuthBoundaryError("SCHEDULE_TURN_CONFLICT", 409);
  if (row.status === "running") return { trigger: triggerForVersion(row, version) };
  if (row.task_session_id !== null) {
    const launch = await new ChatThreadRepository(tx, String(row.user_id)).transitionTaskLaunch({
      source_thread_id: row.source_thread_id, task_id: row.task_session_id,
      action: "claim", error_code: null,
    });
    if (!launch.changed || launch.task.launch_status !== "starting") throw new AuthBoundaryError("SCHEDULE_TASK_SESSION_LAUNCH_CONFLICT", 409);
  }
  const started = (await tx.update(trigger).set({ status: "running", target_turn_id: input.target_turn_id,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return { trigger: triggerForVersion(started, version) };
}
async function finishOne(tx: DataTransaction, service: ScheduledTaskService, input: z.infer<typeof dto.finishScheduledTriggerInputDto>, version: 1 | 2 | 3 = 1) {
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
  if (input.status === "failed" && row.task_session_id !== null) {
    const threads = new ChatThreadRepository(tx, String(row.user_id));
    const launchInput = { source_thread_id: row.source_thread_id, task_id: row.task_session_id };
    if (row.status === "queued") {
      const claimed = await threads.transitionTaskLaunch({ ...launchInput, action: "claim", error_code: null });
      if (!claimed.changed || claimed.task.launch_status !== "starting") throw new AuthBoundaryError("SCHEDULE_TASK_SESSION_LAUNCH_CONFLICT", 409);
    }
    const failed = await threads.transitionTaskLaunch({ ...launchInput, action: "fail", error_code: input.error_code });
    if (!failed.changed && failed.task.launch_status !== "failed") throw new AuthBoundaryError("SCHEDULE_TASK_SESSION_LAUNCH_CONFLICT", 409);
  }
  const updated = (await tx.update(trigger).set({ status: input.status, final_message_id: input.final_message_id,
    error_code: input.error_code, lease_expires_at: null,
    unknown_recheck_at: input.status === "state_unknown"
      ? new Date((await databaseNow(tx)).getTime() + chatScheduledTaskPolicy.unknownRecheckSeconds * 1000).toISOString()
      : null,
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return { trigger: triggerForVersion(updated, version) };
}
async function reconcileOne(tx: DataTransaction, service: ScheduledTaskService, triggerId: string, version: 1 | 2 | 3 = 1) {
  const store = new ScheduledTaskRepository(tx), row = await store.trigger(triggerId, true);
  if (!row || !await store.serviceTask(row.task_id, service.id)) throw new AuthBoundaryError("SCHEDULE_TRIGGER_NOT_FOUND", 404);
  if (!["claimed", "queued", "running", "state_unknown"].includes(row.status)) return { trigger: triggerForVersion(row, version) };
  const now = await databaseNow(tx);
  if (row.status !== "state_unknown" && (!row.lease_expires_at || new Date(row.lease_expires_at) > now)) return { trigger: triggerForVersion(row, version) };
  if (row.target_thread_id && row.target_turn_id) {
      const candidates = await tx.select({ id: message.id, metadata: message.metadata }).from(message).where(and(
        eq(message.thread_id, row.target_thread_id), eq(message.role, "assistant"),
        eq(message.history_projection_version, 1),
      ));
      const final = candidates.find(candidate => isCompletedTurn(candidate.metadata, row.target_turn_id));
      if (final) {
        const succeeded = (await tx.update(trigger).set({ status: "succeeded", final_message_id: final.id,
          lease_expires_at: null, unknown_recheck_at: null, error_code: null, updated_at: sql`CURRENT_TIMESTAMP` })
          .where(eq(trigger.id, row.id)).returning())[0]!;
        return { trigger: triggerForVersion(succeeded, version) };
      }
  }
  // A bound turn is the first point at which the model may have run. Before start,
  // the same TaskSession and input can be prepared again under a new claim.
  if (row.target_turn_id === null) {
    const retryable = (await tx.update(trigger).set({ status: "claimed", claim_id: null,
      lease_expires_at: null, unknown_recheck_at: null, error_code: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(trigger.id, row.id)).returning())[0]!;
    return { trigger: triggerForVersion(retryable, version) };
  }
  // An expired bound turn may have reached the model despite lost transport.
  if (row.status === "state_unknown") return { trigger: triggerForVersion(row, version) };
  const updated = (await tx.update(trigger).set({ status: "state_unknown",
    lease_expires_at: null, error_code: "SCHEDULE_RESULT_UNKNOWN",
    unknown_recheck_at: new Date(now.getTime() + chatScheduledTaskPolicy.unknownRecheckSeconds * 1000).toISOString(),
    updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(trigger.id, row.id)).returning())[0]!;
  return { trigger: triggerForVersion(updated, version) };
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
export async function runChatScheduledBackgroundV2Operation(name: dto.ChatScheduledBackgroundV2Operation, raw: unknown, service: ScheduledTaskService, tx: DataTransaction) {
  requireBackground(service);
  const contract = dto.chatScheduledTaskV2OperationContracts[name], parsed = contract.input.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const baseName = name.replace(".v2.", ".");
  if (baseName === "scheduled-trigger.claim") return dto.claimScheduledTriggerV2ResultDto.parse(await claimOneV2(tx, service.id));
  if (baseName === "scheduled-trigger.prepare") return prepareOne(tx, service, dto.prepareScheduledTriggerInputDto.parse(parsed.data), 2);
  if (baseName === "scheduled-trigger.renew") return renewOne(tx, service, dto.renewScheduledTriggerInputDto.parse(parsed.data), 2);
  if (baseName === "scheduled-trigger.start") return startOne(tx, service, dto.startScheduledTriggerInputDto.parse(parsed.data), 2);
  if (baseName === "scheduled-trigger.finish") return finishOne(tx, service, dto.finishScheduledTriggerInputDto.parse(parsed.data), 2);
  if (baseName === "scheduled-trigger.reconcile") return reconcileOne(tx, service, dto.reconcileScheduledTriggerInputDto.parse(parsed.data).trigger_id, 2);
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}

export async function runChatScheduledBackgroundV3Operation(name: dto.ChatScheduledBackgroundV3Operation, raw: unknown, service: ScheduledTaskService, tx: DataTransaction) {
  requireBackground(service);
  const contract = dto.chatScheduledTaskV3OperationContracts[name], parsed = contract.input.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const baseName = name.replace(".v3.", ".");
  if (baseName === "scheduled-trigger.claim") return dto.claimScheduledTriggerV3ResultDto.parse(await claimOneV2(tx, service.id, 3));
  if (baseName === "scheduled-trigger.prepare") return prepareOne(tx, service, dto.prepareScheduledTriggerInputDto.parse(parsed.data), 3);
  if (baseName === "scheduled-trigger.renew") return renewOne(tx, service, dto.renewScheduledTriggerInputDto.parse(parsed.data), 3);
  if (baseName === "scheduled-trigger.start") return startOne(tx, service, dto.startScheduledTriggerInputDto.parse(parsed.data), 3);
  if (baseName === "scheduled-trigger.finish") return finishOne(tx, service, dto.finishScheduledTriggerInputDto.parse(parsed.data), 3);
  if (baseName === "scheduled-trigger.reconcile") return reconcileOne(tx, service, dto.reconcileScheduledTriggerInputDto.parse(parsed.data).trigger_id, 3);
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}
