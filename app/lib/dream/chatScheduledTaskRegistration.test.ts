// [Input] Immutable Registry204/v1-v2 prefix, additive v3 capability and closed schedule DTOs.
// [Output] Exact v1/v2/v3 operation names, audience separation and rejection of actor/physical selectors.
// [Pos] Provider-free scheduled Chat protocol registration contract.
// [Sync] 2026-10-07: append v3 recurrence/thread/model operations and keep every v1/v2 descriptor unchanged.
// [Sync] 2026-10-07: freeze v1 operations 205–221 and append exact v2 operations 222–238.
import { expect, it } from "vitest";
import generated from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { dreamOperations } from "./operationRegistry";
import { chatScheduledTaskSchemaRequirement, chatScheduledTaskV2SchemaRequirement, chatScheduledTaskV3SchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement } from "./chatScheduledTaskService";
import { scheduledChatRuntimeSchemaRequirement } from "./schemaRequirements";
import { createScheduledTaskInputDto, createScheduledTaskV2InputDto, createScheduledTaskV3InputDto, finishScheduledTriggerInputDto, startScheduledTriggerInputDto, scheduledTaskThreadInputDto } from "./chatScheduledTaskDto";

it("appends the owned Thread reads after all existing descriptors", () => {
  expect(dreamOperations.slice(255, 259).map(item => item.contract.name)).toEqual([
    "notion.sync-run.request", "notion.sync-run.claim", "notion.sync-run.renew", "notion.sync-run.finish",
  ]);
  expect(dreamOperations.at(-2)?.capability).toMatchObject({ name: "scheduled-task.v2.thread", kind: "read",
    user_scope: "dream:read", background_scope: null });
  expect(dreamOperations.at(-1)?.capability).toMatchObject({ name: "scheduled-task.v3.thread", kind: "read",
    user_scope: "dream:read", background_scope: null });
  expect(scheduledTaskThreadInputDto.safeParse({ thread_id: "thread-1" }).success).toBe(true);
  expect(scheduledTaskThreadInputDto.safeParse({ thread_id: "thread-1", user_id: "2" }).success).toBe(false);
});

it("appends the complete v3 protocol with structured recurrence and explicit execution options", () => {
  const added = dreamOperations.slice(238, 255);
  expect(added.map(item => item.contract.name)).toEqual([
    "scheduled-task.v3.create", "scheduled-task.v3.get", "scheduled-task.v3.day", "scheduled-task.v3.history",
    "scheduled-task.v3.edit", "scheduled-task.v3.pause", "scheduled-task.v3.resume", "scheduled-task.v3.delete",
    "scheduled-task.v3.restore", "scheduled-task.v3.run", "scheduled-trigger.v3.claim", "scheduled-trigger.v3.prepare",
    "scheduled-trigger.v3.renew", "scheduled-trigger.v3.start", "scheduled-trigger.v3.finish",
    "scheduled-trigger.v3.reconcile", "scheduled-trigger.v3.authority.resolve",
  ]);
  expect(added.every(item => item.requirements.some(required => required.capability === chatScheduledTaskV3SchemaRequirement.capability))).toBe(true);
  expect(added.slice(10).every(item => item.capability.background_scope === "schedule:execute"
    && item.requirements.some(required => required.capability === scheduledChatRuntimeSchemaRequirement.capability))).toBe(true);
  const create = { source_thread_id: "source", create_request_key: "tool-call-v3", title: "Review",
    prompt: "Review the week", target_editor_session_id: null, run_thread_mode: "source_thread",
    model_alias: "dream-balanced", rule: { kind: "weekly", weekdays: ["MO", "WE", "FR"],
      local_time: "09:30", time_zone: "Asia/Shanghai" } };
  expect(createScheduledTaskV3InputDto.safeParse(create).success).toBe(true);
  expect(createScheduledTaskV3InputDto.safeParse({ ...create, model_alias: null }).success).toBe(false);
  expect(createScheduledTaskV3InputDto.safeParse({ ...create, run_thread_mode: "parallel" }).success).toBe(false);
  expect(createScheduledTaskV3InputDto.safeParse({ ...create, rule: { ...create.rule, weekdays: [] } }).success).toBe(false);
});

it("preserves Registry204 and appends exact scheduled user and worker operations", () => {
  expect(generated).toEqual(dreamOperations);
  expect(dreamOperations.length).toBeGreaterThanOrEqual(221);
  const added = dreamOperations.slice(204, 221);
  expect(added.map(item => item.contract.name)).toEqual([
    "scheduled-task.create", "scheduled-task.get", "scheduled-task.day", "scheduled-task.history",
    "scheduled-task.edit", "scheduled-task.pause", "scheduled-task.resume", "scheduled-task.delete",
    "scheduled-task.restore", "scheduled-task.run", "scheduled-trigger.claim", "scheduled-trigger.prepare",
    "scheduled-trigger.renew", "scheduled-trigger.start", "scheduled-trigger.finish",
    "scheduled-trigger.reconcile", "scheduled-trigger.authority.resolve",
  ]);
  expect(added.every(item => item.requirements.some(required => required.capability === chatScheduledTaskSchemaRequirement.capability))).toBe(true);
  expect(added.every(item => item.requirements.some(required => required.capability === chatScheduledTurnBindingSchemaRequirement.capability))).toBe(true);
  expect(added.every(item => item.requirements.some(required => required.capability === chatScheduledLinkLifecycleSchemaRequirement.capability))).toBe(true);
  expect(added.slice(0, 10).every(item => item.capability.background_scope === null)).toBe(true);
  expect(added.slice(10).every(item => item.capability.background_scope === "schedule:execute" && item.requirements.some(required => required.capability === scheduledChatRuntimeSchemaRequirement.capability))).toBe(true);
});

it("appends the complete v2 protocol without mutating the v1 descriptors", () => {
  const added = dreamOperations.slice(221, 238);
  expect(added.map(item => item.contract.name)).toEqual([
    "scheduled-task.v2.create", "scheduled-task.v2.get", "scheduled-task.v2.day", "scheduled-task.v2.history",
    "scheduled-task.v2.edit", "scheduled-task.v2.pause", "scheduled-task.v2.resume", "scheduled-task.v2.delete",
    "scheduled-task.v2.restore", "scheduled-task.v2.run", "scheduled-trigger.v2.claim", "scheduled-trigger.v2.prepare",
    "scheduled-trigger.v2.renew", "scheduled-trigger.v2.start", "scheduled-trigger.v2.finish",
    "scheduled-trigger.v2.reconcile", "scheduled-trigger.v2.authority.resolve",
  ]);
  expect(added.every(item => item.requirements.some(required => required.capability === chatScheduledTaskV2SchemaRequirement.capability))).toBe(true);
  expect(added.slice(10).every(item => item.capability.background_scope === "schedule:execute"
    && item.requirements.some(required => required.capability === scheduledChatRuntimeSchemaRequirement.capability))).toBe(true);
  const interval = { source_thread_id: "source", create_request_key: "tool-call-v2", title: "Poll",
    prompt: "Update the note", target_editor_session_id: "note-1",
    rule: { kind: "interval", interval_minutes: 10, time_zone: "Asia/Shanghai" } };
  expect(createScheduledTaskV2InputDto.safeParse(interval).success).toBe(true);
  expect(createScheduledTaskV2InputDto.safeParse({ ...interval, rule: { ...interval.rule, interval_minutes: 0 } }).success).toBe(false);
  expect(createScheduledTaskV2InputDto.safeParse({ ...interval, rule: { ...interval.rule, local_time: "09:00" } }).success).toBe(false);
});

it("rejects caller identity, SQL and unbound completion selectors", () => {
  const create = { source_thread_id: "source", create_request_key: "tool-call-1", title: "Daily", prompt: "Write a note",
    rule: { kind: "daily", local_time: "09:30", time_zone: "Asia/Shanghai" } };
  expect(createScheduledTaskInputDto.safeParse(create).success).toBe(true);
  expect(createScheduledTaskInputDto.safeParse({ ...create, user_id: "1" }).success).toBe(false);
  expect(createScheduledTaskInputDto.safeParse({ ...create, sql: "SELECT 1" }).success).toBe(false);
  const start = { trigger_id: "550e8400-e29b-41d4-a716-446655440000", claim_id: "550e8400-e29b-41d4-a716-446655440001", target_turn_id: "turn-a" };
  expect(startScheduledTriggerInputDto.safeParse(start).success).toBe(true);
  expect(startScheduledTriggerInputDto.safeParse({ ...start, target_thread_id: "other" }).success).toBe(false);
  expect(finishScheduledTriggerInputDto.safeParse({ trigger_id: start.trigger_id, claim_id: start.claim_id,
    status: "running", final_message_id: null, error_code: null }).success).toBe(false);
});
