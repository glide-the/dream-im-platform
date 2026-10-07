// [Input] Immutable Registry204 prefix, four physical capabilities and closed schedule DTOs.
// [Output] Additive operation names, audience separation and rejection of actor/physical selectors.
// [Pos] Provider-free scheduled Chat protocol registration contract.
// [Sync] 2026-10-07: freeze scheduled operations 205–221 while allowing later reviewed registry additions.
import { expect, it } from "vitest";
import generated from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { dreamOperations } from "./operationRegistry";
import { chatScheduledTaskSchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement } from "./chatScheduledTaskService";
import { scheduledChatRuntimeSchemaRequirement } from "./schemaRequirements";
import { createScheduledTaskInputDto, finishScheduledTriggerInputDto, startScheduledTriggerInputDto } from "./chatScheduledTaskDto";

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
