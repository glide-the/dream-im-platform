// [Input] Actor-free Dream auto-repair message identity and requested terminal status.
// [Output] Strict Registry169 settlement command and idempotent result.
// [Pos] Cross-project DTO; actor, role, database and transaction stay Admin-derived.
// [Sync] 2026-09-16: define the auto-repair DTO-Service-ORM boundary.
import { z } from "zod";
import { workflowRunIdDto } from "./workflowRunDto";

const entityId = z.string().min(1).max(512);
const projectSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const validationCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/);

export const dreamAutoRepairIdentityDto = z.strictObject({
  kind: z.literal("story-workspace-dream-auto-repair"),
  schema_version: z.literal("story-workspace-dream-auto-repair/v1"),
  originating_message_id: entityId,
  originating_turn_id: entityId,
  workflow_run_id: workflowRunIdDto,
  repair_attempt: z.literal(1),
  validation_code: validationCode,
  idempotency_key: z.string().regex(/^dream-auto-repair\/v1:[0-9a-f]{64}$/),
  project_cleanup: z.strictObject({
    trusted_project_slug: projectSlug,
    stale_project_slugs: z.array(projectSlug).min(1),
  }).nullable(),
}).superRefine((value, context) => {
  if (value.project_cleanup === null) return;
  const stale = value.project_cleanup.stale_project_slugs;
  if (new Set(stale).size !== stale.length || stale.includes(value.project_cleanup.trusted_project_slug)) {
    context.addIssue({ code: "custom", path: ["project_cleanup"], message: "Project cleanup scope is invalid" });
  }
});

export const dreamAutoRepairSettleInputDto = z.strictObject({
  thread_id: entityId,
  message_id: entityId,
  expected_identity: dreamAutoRepairIdentityDto,
  status: z.enum(["dispatched", "failed"]),
});

export const dreamAutoRepairSettleOutputDto = z.strictObject({
  message_id: entityId,
  status: z.enum(["dispatched", "failed"]),
  changed: z.boolean(),
});

export const dreamAutoRepairOperationContracts = {
  "dream-auto-repair.settle": {
    kind: "write" as const,
    userScope: "dream:write",
    input: dreamAutoRepairSettleInputDto,
    output: dreamAutoRepairSettleOutputDto,
  },
};

export type DreamAutoRepairIdentity = z.infer<typeof dreamAutoRepairIdentityDto>;
export type DreamAutoRepairSettleInput = z.infer<typeof dreamAutoRepairSettleInputDto>;
export type DreamAutoRepairOperation = keyof typeof dreamAutoRepairOperationContracts;
