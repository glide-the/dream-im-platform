// [Input] Closed policy/diagnostics schemas shared with Admin governance.
// [Output] Strict v1 off-path operation input/output DTOs, no ORM entities.
// [Pos] Resource-policy and observer domain wire contract.
// [Sync] 2026-09-14: distinguish invalid/not-configured desired policy from unavailable transport.
import { z } from "zod";
import { requestIdDto, isoTimeDto } from "../auth/dto";
import { storedPolicySchema, claudeAgentResourceSnapshotSchema } from "../claude-agent-resource-dto";
export const resourcePolicyReadInputDto = z.strictObject({});
export const resourcePolicyReadRequestDto = z.strictObject({ request_id: requestIdDto, input: resourcePolicyReadInputDto });
export const resourcePolicyReadOutputDto = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("configured"), value: storedPolicySchema, updated_at: isoTimeDto }),
  z.strictObject({ status: z.enum(["not_configured", "invalid"]), value: z.null(), updated_at: z.null() }),
]);
export const resourceObserverPublishInputDto = z.strictObject({
  instance_id: z.uuid(), process_started_at: isoTimeDto, sampled_at: isoTimeDto.nullable(), snapshot: claudeAgentResourceSnapshotSchema,
}).superRefine((value, ctx) => {
  if (value.sampled_at !== value.snapshot.sample.sampled_at) ctx.addIssue({ code: "custom", path: ["sampled_at"], message: "Sample timestamp must match diagnostics." });
});
export const resourceObserverPublishRequestDto = z.strictObject({ request_id: requestIdDto, input: resourceObserverPublishInputDto });
export const resourceObserverPublishOutputDto = z.strictObject({ accepted: z.literal(true), heartbeat_at: isoTimeDto, sampled_at: isoTimeDto.nullable() });
