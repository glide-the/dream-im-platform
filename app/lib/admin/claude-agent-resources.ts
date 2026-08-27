// [Input] Authenticated Admin requests plus the shared PostgreSQL desired-policy and observer snapshot relations.
// [Output] Strict desired/effective resource projection and audited optimistic desired-policy updates.
// [Pos] PostgreSQL-only system-governance boundary; it never calls Dream or controls processes/deployments.
// [Sync] 2026-08-27: require the exact observer capability inside both read and write database boundaries.

import "server-only";

import type { PoolClient } from "pg";
import { z } from "zod";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

const boundedInteger = (key: keyof typeof policy.bounds) =>
  z.number().int().min(policy.bounds[key].min).max(policy.bounds[key].max);

export const claudeAgentResourcePolicyInputSchema = z
  .object({
    maxConcurrentRuns: boundedInteger("maxConcurrentRuns"),
    runMemoryBudgetMib: boundedInteger("runMemoryBudgetMib"),
    memoryReserveMib: boundedInteger("memoryReserveMib"),
    retryAfterSeconds: boundedInteger("retryAfterSeconds"),
  })
  .strict();

export const claudeAgentResourcePolicyMutationSchema =
  claudeAgentResourcePolicyInputSchema
    .extend({ expectedRevision: z.number().int().positive().nullable() })
    .strict();

const storedPolicySchema = claudeAgentResourcePolicyInputSchema
  .extend({
    schemaVersion: z.literal(policy.schemaVersion),
    revision: z.number().int().positive(),
  })
  .strict();

const admissionValuesSchema = z
  .object({
    max_concurrent_runs: z.number().int().positive(),
    run_memory_budget_mib: z.number().int().nonnegative(),
    memory_reserve_mib: z.number().int().nonnegative(),
    retry_after_seconds: z.number().int().nonnegative(),
    required_headroom_bytes: z.number().int().nonnegative(),
  })
  .strict();

const nullableCount = z.number().int().nonnegative().nullable();
const nullableBytes = z.number().int().nonnegative().nullable();
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
        policy_revision: z.number().int().positive().nullable(),
        policy_updated_at: nullableTimestamp,
      })
      .strict(),
    turns: z
      .object({
        started_total: z.number().int().nonnegative(),
        completed_total: z.number().int().nonnegative(),
        failed_total: z.number().int().nonnegative(),
        cancelled_total: z.number().int().nonnegative(),
      })
      .strict(),
    admission: z
      .object({
        active_runs: z.number().int().nonnegative(),
        max_concurrent_runs: z.number().int().positive(),
        granted_total: z.number().int().nonnegative(),
        capacity_denials_total: z.number().int().nonnegative(),
        memory_pressure_denials_total: z.number().int().nonnegative(),
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
        required_headroom_bytes: z.number().int().nonnegative(),
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
        queue_dropped_total: z.number().int().nonnegative(),
        write_errors_total: z.number().int().nonnegative(),
        last_write_error_at: nullableTimestamp,
      })
      .strict(),
  })
  .strict();

export type ClaudeAgentResourceSnapshot = z.infer<typeof claudeAgentResourceSnapshotSchema>;
export type ClaudeAgentResourcePolicyInput = z.infer<typeof claudeAgentResourcePolicyInputSchema>;

type ResourceProjectionRow = {
  desired_value: unknown | null;
  desired_updated_at: Date | string | null;
  instance_id: string | null;
  process_started_at: Date | string | null;
  heartbeat_at: Date | string | null;
  sampled_at: Date | string | null;
  snapshot: unknown | null;
  heartbeat_age_seconds: number | string | null;
  sample_age_seconds: number | string | null;
};

type DesiredRow = { value: unknown; updated_at: Date | string };
type CapabilityRow = { version: number; contract_sha256: string };

async function assertExactResourceCapability(client: PoolClient) {
  const capabilityResult = await client.query<CapabilityRow>(
    `SELECT version, contract_sha256
       FROM drizzle.schema_capabilities
      WHERE capability = $1`,
    [policy.observer.capability],
  );
  const capability = capabilityResult.rows[0];
  if (!capability) {
    throw new AdminError(
      "CLAUDE_AGENT_RESOURCE_CAPABILITY_UNAVAILABLE",
      "The Claude Agent resource observer database capability is unavailable",
      503,
    );
  }
  if (
    capability.version !== policy.observer.version ||
    capability.contract_sha256 !== policy.observer.contractSha256
  ) {
    throw new AdminError(
      "CLAUDE_AGENT_RESOURCE_CAPABILITY_MISMATCH",
      "The Claude Agent resource observer database capability does not match this Admin release",
      503,
    );
  }
}

function toIso(value: Date | string | null) {
  if (value === null) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

function toAge(value: number | string | null) {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function storedRevision(value: unknown) {
  const parsed = z.object({ revision: z.number().int().positive() }).passthrough().safeParse(value);
  return parsed.success ? parsed.data.revision : null;
}

function parseDesired(value: unknown | null, updatedAt: Date | string | null) {
  const updatedAtIso = toIso(updatedAt);
  if (value === null) {
    return { status: "not_configured" as const, values: null, revision: null, updatedAt: null };
  }
  const parsed = storedPolicySchema.safeParse(value);
  if (!parsed.success || !updatedAtIso) {
    return {
      status: "invalid" as const,
      values: null,
      revision: storedRevision(value),
      updatedAt: updatedAtIso,
    };
  }
  return {
    status: "valid" as const,
    values: parsed.data,
    revision: parsed.data.revision,
    updatedAt: updatedAtIso,
  };
}

function effectiveAsDesired(snapshot: ClaudeAgentResourceSnapshot) {
  const effective = snapshot.config.effective;
  return {
    maxConcurrentRuns: effective.max_concurrent_runs,
    runMemoryBudgetMib: effective.run_memory_budget_mib,
    memoryReserveMib: effective.memory_reserve_mib,
    retryAfterSeconds: effective.retry_after_seconds,
  };
}

function projectRuntime(row: ResourceProjectionRow) {
  if (!row.instance_id || row.snapshot === null) {
    return { runtime: null, runtimeError: null };
  }
  const parsed = claudeAgentResourceSnapshotSchema.safeParse(row.snapshot);
  const processStartedAt = toIso(row.process_started_at);
  const heartbeatAt = toIso(row.heartbeat_at);
  const sampledAt = toIso(row.sampled_at);
  const heartbeatAgeSeconds = toAge(row.heartbeat_age_seconds);
  const sampleAgeSeconds = toAge(row.sample_age_seconds);
  if (!parsed.success || !processStartedAt || !heartbeatAt || heartbeatAgeSeconds === null) {
    return {
      runtime: null,
      runtimeError: {
        code: "CLAUDE_AGENT_RESOURCE_SNAPSHOT_INVALID",
        message: "The latest Claude Agent resource snapshot is invalid",
      },
    };
  }
  const freshness = heartbeatAgeSeconds <= policy.observer.freshSeconds
    ? "fresh"
    : heartbeatAgeSeconds > policy.observer.offlineSeconds
      ? "offline"
      : "stale";
  const sampleStale = parsed.data.sample.stale || freshness !== "fresh";
  return {
    runtime: {
      instance_id: row.instance_id,
      process_started_at: processStartedAt,
      heartbeat_at: heartbeatAt,
      heartbeat_age_seconds: heartbeatAgeSeconds,
      sampled_at: sampledAt,
      sample_age_seconds: sampleAgeSeconds,
      freshness,
      ...parsed.data,
      admission: {
        ...parsed.data.admission,
        can_start_new_agent: sampleStale ? null : parsed.data.admission.can_start_new_agent,
      },
      sample: { ...parsed.data.sample, stale: sampleStale },
    },
    runtimeError: null,
  };
}

function applicationState(
  desired: ReturnType<typeof parseDesired>,
  runtime: ReturnType<typeof projectRuntime>["runtime"],
) {
  if (desired.status === "invalid") {
    return { status: "invalid" as const, applied: null };
  }
  if (!runtime || runtime.freshness !== "fresh") {
    return { status: "unavailable" as const, applied: null };
  }
  if (desired.status === "not_configured") {
    return { status: "not_configured" as const, applied: false };
  }
  const effective = effectiveAsDesired(runtime);
  const valuesMatch = (Object.keys(effective) as Array<keyof typeof effective>).every(
    (key) => desired.values?.[key] === effective[key],
  );
  const applied = valuesMatch && runtime.config.policy_revision === desired.revision;
  return { status: applied ? ("applied" as const) : ("pending" as const), applied };
}

async function loadProjection() {
  try {
    return await withPlatformClient(async (client) => {
      await assertExactResourceCapability(client);
      const result = await client.query<ResourceProjectionRow>(
        `SELECT
           desired.value AS desired_value,
           desired.updated_at AS desired_updated_at,
           latest.instance_id,
           latest.process_started_at,
           latest.heartbeat_at,
           latest.sampled_at,
           latest.snapshot,
           GREATEST(0, EXTRACT(EPOCH FROM (NOW() - latest.heartbeat_at)))::double precision AS heartbeat_age_seconds,
           CASE
             WHEN latest.sampled_at IS NULL THEN NULL
             ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - latest.sampled_at)))::double precision
           END AS sample_age_seconds
         FROM (SELECT 1) AS singleton
         LEFT JOIN system_settings AS desired
           ON desired.category = $1 AND desired.key = $2
         LEFT JOIN LATERAL (
           SELECT instance_id, process_started_at, heartbeat_at, sampled_at, snapshot
             FROM claude_agent_resource_snapshots
            ORDER BY heartbeat_at DESC, instance_id ASC
            LIMIT 1
         ) AS latest ON TRUE`,
        [policy.setting.category, policy.setting.key],
      );
      const row = result.rows[0];
      if (!row) {
        throw new AdminError(
          "CLAUDE_AGENT_RESOURCE_STORE_UNAVAILABLE",
          "Claude Agent resource data is unavailable",
          503,
        );
      }
      return row;
    });
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError(
      "CLAUDE_AGENT_RESOURCE_STORE_UNAVAILABLE",
      "Claude Agent resource data is unavailable",
      503,
    );
  }
}

export async function handleClaudeAgentResourcesGet(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "system.read");
    const row = await loadProjection();
    const desired = parseDesired(row.desired_value, row.desired_updated_at);
    const { runtime, runtimeError } = projectRuntime(row);
    return Response.json(
      {
        data: {
          policy: {
            schemaVersion: policy.schemaVersion,
            bounds: policy.bounds,
            defaults: policy.defaults,
            freshness: {
              freshSeconds: policy.observer.freshSeconds,
              offlineSeconds: policy.observer.offlineSeconds,
            },
          },
          desired,
          runtime,
          runtimeError,
          application: applicationState(desired, runtime),
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleClaudeAgentResourcesPatch(request: Request) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "system.write");
    const input = claudeAgentResourcePolicyMutationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) {
      throw new AdminError(
        "CLAUDE_AGENT_POLICY_INVALID",
        "Claude Agent resource policy is invalid",
        400,
        input.error.issues,
      );
    }
    const desired = await withPlatformTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [policy.setting.id]);
      await assertExactResourceCapability(client);
      const locked = await client.query<DesiredRow>(
        `SELECT value, updated_at
           FROM system_settings
          WHERE category = $1 AND key = $2
          FOR UPDATE`,
        [policy.setting.category, policy.setting.key],
      );
      const beforeRow = locked.rows[0];
      const currentRevision = beforeRow ? storedRevision(beforeRow.value) : null;
      if (input.data.expectedRevision !== currentRevision) {
        throw new AdminError(
          "CLAUDE_AGENT_POLICY_REVISION_CONFLICT",
          "The Claude Agent resource policy changed before this update",
          409,
          { expectedRevision: input.data.expectedRevision, currentRevision },
        );
      }
      const stored = {
        schemaVersion: policy.schemaVersion,
        revision: (currentRevision ?? 0) + 1,
        maxConcurrentRuns: input.data.maxConcurrentRuns,
        runMemoryBudgetMib: input.data.runMemoryBudgetMib,
        memoryReserveMib: input.data.memoryReserveMib,
        retryAfterSeconds: input.data.retryAfterSeconds,
      };
      const result = await client.query<DesiredRow>(
        `INSERT INTO system_settings (
           id, category, key, value, description, is_secret, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5, FALSE, 'active', NOW(), NOW())
         ON CONFLICT (category, key) DO UPDATE SET
           value = EXCLUDED.value,
           description = EXCLUDED.description,
           is_secret = FALSE,
           status = 'active',
           updated_at = NOW()
         RETURNING value, updated_at`,
        [
          policy.setting.id,
          policy.setting.category,
          policy.setting.key,
          JSON.stringify(stored),
          policy.setting.description,
        ],
      );
      const afterRow = result.rows[0];
      const after = afterRow ? storedPolicySchema.safeParse(afterRow.value) : null;
      const afterUpdatedAt = afterRow ? toIso(afterRow.updated_at) : null;
      if (!after?.success || !afterUpdatedAt) {
        throw new AdminError(
          "CLAUDE_AGENT_POLICY_STORE_UNAVAILABLE",
          "Claude Agent desired configuration could not be verified",
          503,
        );
      }
      const before = beforeRow ? storedPolicySchema.safeParse(beforeRow.value) : null;
      await recordAdminAuditOnClient(client, {
        identity,
        action: "update",
        resourceType: "claude_agent_resource_policy",
        resourceId: policy.setting.id,
        requestId,
        request,
        before: before?.success
          ? before.data
          : currentRevision === null
            ? undefined
            : { revision: currentRevision },
        after: after.data,
      });
      return {
        status: "valid" as const,
        values: after.data,
        revision: after.data.revision,
        updatedAt: afterUpdatedAt,
      };
    }).catch((error) => {
      if (error instanceof AdminError) throw error;
      throw new AdminError(
        "CLAUDE_AGENT_POLICY_STORE_UNAVAILABLE",
        "Claude Agent desired configuration could not be saved",
        503,
      );
    });
    return Response.json(
      { data: { desired } },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
