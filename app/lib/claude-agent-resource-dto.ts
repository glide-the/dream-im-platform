// [Input] Resource policy precision rules and closed content-free diagnostics.
// [Output] Shared strict desired/effective policy and snapshot DTO schemas.
// [Pos] Pure validation contract used by Admin governance and Dream domain APIs.
// [Sync] 2026-09-14: extract existing validators without changing policy semantics.
import { z } from "zod";
import { claudeAgentResourcePolicy as policy } from "../../config/claude-agent-resource-policy";

const boundedInteger = (key: keyof typeof policy.bounds) => {
  const bound = policy.bounds[key];
  const schema = z.number().int().safe().min(bound.min);
  return bound.max === null ? schema : schema.max(bound.max);
};

export const positiveSafeInteger = z.number().int().safe().positive();
const safeNonnegativeInteger = z.number().int().safe().nonnegative();

export const policyValueShape = {
  maxConcurrentRuns: boundedInteger("maxConcurrentRuns"),
  runMemoryBudgetMib: boundedInteger("runMemoryBudgetMib"),
  memoryReserveMib: boundedInteger("memoryReserveMib"),
  retryAfterSeconds: boundedInteger("retryAfterSeconds"),
};
const claudeCodeEffortLevelSchema = z.enum(policy.claudeCodeRuntime.effortLevels).nullable();
export const policyRuntimeShape = {
  claudeCodeEffortLevel: claudeCodeEffortLevelSchema.default(null),
};

type MemoryPolicyValues = {
  runMemoryBudgetMib: number;
  memoryReserveMib: number;
};

function combinedMemoryMibIsSafe(runMemoryBudgetMib: number, memoryReserveMib: number) {
  const combined = runMemoryBudgetMib + memoryReserveMib;
  return Number.isSafeInteger(combined)
    && combined <= policy.technicalLimits.maxCombinedMemoryMib;
}

function validatePolicyMemory(values: MemoryPolicyValues, context: z.RefinementCtx) {
  if (combinedMemoryMibIsSafe(values.runMemoryBudgetMib, values.memoryReserveMib)) return;
  for (const path of ["runMemoryBudgetMib", "memoryReserveMib"] as const) {
    context.addIssue({
      code: "custom",
      path: [path],
      message: "Combined memory exceeds the exact JSON integer range",
    });
  }
}

export const claudeAgentResourcePolicyInputSchema = z
  .object({ ...policyValueShape, ...policyRuntimeShape })
  .strict()
  .superRefine(validatePolicyMemory);

export const claudeAgentResourcePolicyMutationSchema =
  z.object({
    ...policyValueShape,
    ...policyRuntimeShape,
    expectedRevision: positiveSafeInteger.nullable(),
  })
    .strict()
    .superRefine(validatePolicyMemory);

export const storedPolicySchema = z
  .object({
    ...policyValueShape,
    claudeCodeEffortLevel: claudeCodeEffortLevelSchema.default(null),
    schemaVersion: z.literal(policy.schemaVersion),
    revision: positiveSafeInteger,
  })
  .strict()
  .superRefine(validatePolicyMemory);

export const admissionValuesSchema = z
  .object({
    max_concurrent_runs: boundedInteger("maxConcurrentRuns"),
    run_memory_budget_mib: boundedInteger("runMemoryBudgetMib"),
    memory_reserve_mib: boundedInteger("memoryReserveMib"),
    retry_after_seconds: boundedInteger("retryAfterSeconds"),
    required_headroom_bytes: safeNonnegativeInteger,
  })
  .strict()
  .superRefine((values, context) => {
    if (!combinedMemoryMibIsSafe(
      values.run_memory_budget_mib,
      values.memory_reserve_mib,
    )) {
      context.addIssue({
        code: "custom",
        path: ["required_headroom_bytes"],
        message: "Combined memory exceeds the exact JSON integer range",
      });
      return;
    }
    const expected = (values.run_memory_budget_mib + values.memory_reserve_mib)
      * policy.technicalLimits.mibInBytes;
    if (values.required_headroom_bytes !== expected) {
      context.addIssue({
        code: "custom",
        path: ["required_headroom_bytes"],
        message: "Required headroom does not match the configured memory values",
      });
    }
  });

const nullableCount = safeNonnegativeInteger.nullable();
const nullableBytes = safeNonnegativeInteger.nullable();
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();

export const claudeAgentResourceSnapshotSchema = z
  .object({
    schema_version: z.literal(1),
    backend_status: z.literal("ok"),
    scope: z
      .object({
        active_runs: z.literal("process"),
        counters: z.literal("process_lifetime"),
        reset_on_restart: z.literal(true),
      })
      .strict(),
    config: z
      .object({
        defaults: admissionValuesSchema,
        effective: admissionValuesSchema,
        effective_version: z.string().min(1).max(128),
        loaded_at: z.string().datetime({ offset: true }),
        policy_status: z.enum(["applied", "not_configured", "invalid", "unavailable"]),
        policy_revision: positiveSafeInteger.nullable(),
        policy_updated_at: nullableTimestamp,
        claude_code: z.object({
          effort_level: claudeCodeEffortLevelSchema,
        }).strict().optional(),
      })
      .strict(),
    turns: z
      .object({
        started_total: safeNonnegativeInteger,
        completed_total: safeNonnegativeInteger,
        failed_total: safeNonnegativeInteger,
        cancelled_total: safeNonnegativeInteger,
      })
      .strict(),
    admission: z
      .object({
        active_runs: safeNonnegativeInteger,
        max_concurrent_runs: boundedInteger("maxConcurrentRuns"),
        granted_total: safeNonnegativeInteger,
        capacity_denials_total: safeNonnegativeInteger,
        memory_pressure_denials_total: safeNonnegativeInteger,
        last_denial_type: z.enum(["capacity", "memory_pressure"]).nullable(),
        last_denial_at: nullableTimestamp,
        can_start_new_agent: z.boolean().nullable(),
      })
      .strict(),
    claude_processes: z
      .object({
        available: z.boolean(),
        count: nullableCount,
        total_rss_bytes: nullableBytes,
      })
      .strict(),
    memory: z
      .object({
        host_available_bytes: nullableBytes,
        cgroup_current_bytes: nullableBytes,
        cgroup_max_bytes: nullableBytes,
        cgroup_raw_headroom_bytes: nullableBytes,
        inactive_file_bytes: nullableBytes,
        slab_reclaimable_bytes: nullableBytes,
        cgroup_reclaimable_bytes: nullableBytes,
        cgroup_effective_headroom_bytes: nullableBytes,
        required_headroom_bytes: safeNonnegativeInteger,
        events: z
          .object({
            low: nullableCount,
            high: nullableCount,
            max: nullableCount,
            oom: nullableCount,
            oom_kill: nullableCount,
          })
          .strict(),
      })
      .strict(),
    sample: z
      .object({
        status: z.enum(["starting", "ok", "unavailable", "timeout", "error"]),
        sampled_at: nullableTimestamp,
        stale: z.boolean(),
        error_code: z.string().min(1).max(160).nullable(),
      })
      .strict(),
    pipeline: z
      .object({
        queue_dropped_total: safeNonnegativeInteger,
        write_errors_total: safeNonnegativeInteger,
        last_write_error_at: nullableTimestamp,
      })
      .strict(),
  })
  .strict();

export type ClaudeAgentResourceSnapshot = z.infer<typeof claudeAgentResourceSnapshotSchema>;
export type ClaudeAgentResourcePolicyInput = z.infer<typeof claudeAgentResourcePolicyInputSchema>;
