// [Input] Authenticated Admin requests, the fixed desired-policy row, and Dream's protected diagnostics endpoint.
// [Output] Strict desired/effective policy projection plus content-free Claude Agent runtime diagnostics.
// [Pos] Dedicated system-governance boundary; it never changes Dream admission or executes process controls.

import "server-only";

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

const storedPolicySchema = claudeAgentResourcePolicyInputSchema.extend({
  schemaVersion: z.literal(policy.schemaVersion),
  revision: z.number().int().positive(),
});

const admissionValuesSchema = z
  .object({
    max_concurrent_runs: z.number().int().positive(),
    run_memory_budget_mib: z.number().int().nonnegative(),
    memory_reserve_mib: z.number().int().nonnegative(),
    retry_after_seconds: z.number().int().nonnegative(),
    required_headroom_bytes: z.number().int().nonnegative(),
  });

const nullableCount = z.number().int().nonnegative().nullable();
const nullableBytes = z.number().int().nonnegative().nullable();
const nullableTimestamp = z.string().datetime({ offset: true }).nullable();

const dreamDiagnosticsSchema = z.object({
  schema_version: z.literal(1),
  backend_status: z.literal("ok"),
  scope: z.object({
    active_runs: z.literal("process"),
    counters: z.literal("process_lifetime"),
    reset_on_restart: z.boolean(),
  }),
  config: z.object({
    defaults: admissionValuesSchema,
    environment: z.object({
      max_concurrent_runs: z.number().int().positive().nullable(),
      run_memory_budget_mib: z.number().int().nonnegative().nullable(),
      memory_reserve_mib: z.number().int().nonnegative().nullable(),
      retry_after_seconds: z.number().int().nonnegative().nullable(),
    }),
    effective: admissionValuesSchema,
    effective_version: z.string().min(1).max(128),
    loaded_at: z.string().datetime({ offset: true }),
    restart_required: z.boolean(),
  }),
  turns: z.object({
    started_total: z.number().int().nonnegative(),
    completed_total: z.number().int().nonnegative(),
    failed_total: z.number().int().nonnegative(),
    cancelled_total: z.number().int().nonnegative(),
  }),
  admission: z.object({
    active_runs: z.number().int().nonnegative(),
    max_concurrent_runs: z.number().int().positive(),
    granted_total: z.number().int().nonnegative(),
    capacity_denials_total: z.number().int().nonnegative(),
    memory_pressure_denials_total: z.number().int().nonnegative(),
    last_denial_type: z.enum(["capacity", "memory_pressure"]).nullable(),
    last_denial_at: nullableTimestamp,
    can_start_new_agent: z.boolean(),
  }),
  claude_processes: z.object({
    available: z.boolean(),
    count: nullableCount,
    total_rss_bytes: nullableBytes,
  }),
  memory: z.object({
    host_available_bytes: nullableBytes,
    cgroup_current_bytes: nullableBytes,
    cgroup_max_bytes: nullableBytes,
    cgroup_raw_headroom_bytes: nullableBytes,
    inactive_file_bytes: nullableBytes,
    slab_reclaimable_bytes: nullableBytes,
    cgroup_reclaimable_bytes: nullableBytes,
    cgroup_effective_headroom_bytes: nullableBytes,
    required_headroom_bytes: z.number().int().nonnegative(),
    events: z.object({
      low: nullableCount,
      high: nullableCount,
      max: nullableCount,
      oom: nullableCount,
      oom_kill: nullableCount,
    }),
  }),
  sample: z.object({
    status: z.enum(["starting", "ok", "unavailable", "timeout", "error"]),
    sampled_at: z.string().datetime({ offset: true }).nullable(),
    age_seconds: z.number().nonnegative().nullable(),
    stale: z.boolean(),
    error_code: z.string().max(160).nullable(),
  }),
});

export type DreamClaudeAgentDiagnostics = z.infer<typeof dreamDiagnosticsSchema>;
export type ClaudeAgentResourcePolicyInput = z.infer<typeof claudeAgentResourcePolicyInputSchema>;

type DesiredRow = { value: unknown; updated_at: Date | string };

function parseDesired(row?: DesiredRow) {
  if (!row) return null;
  const parsed = storedPolicySchema.safeParse(row.value);
  if (!parsed.success) {
    throw new AdminError(
      "CLAUDE_AGENT_POLICY_INVALID",
      "The stored Claude Agent resource policy is invalid",
      503,
    );
  }
  return {
    ...parsed.data,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function effectiveAsDesired(runtime: DreamClaudeAgentDiagnostics) {
  const effective = runtime.config.effective;
  return {
    maxConcurrentRuns: effective.max_concurrent_runs,
    runMemoryBudgetMib: effective.run_memory_budget_mib,
    memoryReserveMib: effective.memory_reserve_mib,
    retryAfterSeconds: effective.retry_after_seconds,
  };
}

function applicationState(
  desired: ReturnType<typeof parseDesired>,
  runtime: DreamClaudeAgentDiagnostics | null,
) {
  if (!runtime) {
    return { status: "unknown" as const, applied: null, restartRequired: null };
  }
  if (!desired) {
    return { status: "not_configured" as const, applied: false, restartRequired: false };
  }
  const effective = effectiveAsDesired(runtime);
  const applied = (Object.keys(effective) as Array<keyof typeof effective>).every(
    (key) => desired[key] === effective[key],
  );
  return {
    status: applied ? ("applied" as const) : ("pending" as const),
    applied,
    restartRequired: !applied,
  };
}

function diagnosticsUrl() {
  const raw = process.env.DREAM_DIAGNOSTICS_BASE_URL?.trim();
  if (!raw) {
    throw new AdminError(
      "DREAM_DIAGNOSTICS_NOT_CONFIGURED",
      "Dream diagnostics endpoint is not configured",
      503,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AdminError("DREAM_DIAGNOSTICS_CONFIG_INVALID", "Dream diagnostics endpoint is invalid", 503);
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) {
    throw new AdminError("DREAM_DIAGNOSTICS_CONFIG_INVALID", "Dream diagnostics endpoint is not trusted", 503);
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/internal/claude-agent/resources`;
  return url.toString();
}

export async function fetchDreamClaudeAgentDiagnostics(signal?: AbortSignal) {
  const token = process.env.DREAM_DIAGNOSTICS_TOKEN;
  if (!token || token.length < 32) {
    throw new AdminError("DREAM_DIAGNOSTICS_NOT_CONFIGURED", "Dream diagnostics authentication is not configured", 503);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), 3_000);
  try {
    const response = await fetch(diagnosticsUrl(), {
      signal: controller.signal,
      cache: "no-store",
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new AdminError("DREAM_DIAGNOSTICS_UNAVAILABLE", "Dream diagnostics is unavailable", 503);
    }
    const body = await response.json().catch(() => null);
    const parsed = dreamDiagnosticsSchema.safeParse(body);
    if (!parsed.success) {
      throw new AdminError("DREAM_DIAGNOSTICS_INVALID", "Dream returned invalid diagnostics", 502);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError("DREAM_DIAGNOSTICS_UNAVAILABLE", "Dream diagnostics is unavailable", 503);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function loadDesired() {
  try {
    return await withPlatformClient(async (client) => {
      const result = await client.query<DesiredRow>(
        `SELECT value, updated_at
           FROM system_settings
          WHERE category = $1 AND key = $2`,
        [policy.setting.category, policy.setting.key],
      );
      return parseDesired(result.rows[0]);
    });
  } catch (error) {
    if (error instanceof AdminError) throw error;
    throw new AdminError(
      "CLAUDE_AGENT_POLICY_STORE_UNAVAILABLE",
      "Claude Agent desired configuration is unavailable",
      503,
    );
  }
}

export async function handleClaudeAgentResourcesGet(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "system.read");
    const desired = await loadDesired();
    let runtime: DreamClaudeAgentDiagnostics | null = null;
    let runtimeError: { code: string; message: string } | null = null;
    try {
      runtime = await fetchDreamClaudeAgentDiagnostics(request.signal);
    } catch (error) {
      const resolved = error instanceof AdminError
        ? error
        : new AdminError("DREAM_DIAGNOSTICS_UNAVAILABLE", "Dream diagnostics is unavailable", 503);
      runtimeError = { code: resolved.code, message: resolved.message };
    }
    return Response.json(
      {
        data: {
          policy: { schemaVersion: policy.schemaVersion, bounds: policy.bounds, defaults: policy.defaults },
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
    const input = claudeAgentResourcePolicyInputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      throw new AdminError("CLAUDE_AGENT_POLICY_INVALID", "Claude Agent resource policy is invalid", 400, input.error.issues);
    }
    const desired = await withPlatformTransaction(async (client) => {
      const locked = await client.query<DesiredRow>(
        `SELECT value, updated_at
           FROM system_settings
          WHERE category = $1 AND key = $2
          FOR UPDATE`,
        [policy.setting.category, policy.setting.key],
      );
      const before = parseDesired(locked.rows[0]);
      const stored = {
        schemaVersion: policy.schemaVersion,
        revision: (before?.revision ?? 0) + 1,
        ...input.data,
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
        [policy.setting.id, policy.setting.category, policy.setting.key, JSON.stringify(stored), policy.setting.description],
      );
      const after = parseDesired(result.rows[0]);
      await recordAdminAuditOnClient(client, {
        identity,
        action: "update",
        resourceType: "claude_agent_resource_policy",
        resourceId: policy.setting.id,
        requestId,
        request,
        before: before ?? undefined,
        after: after ?? undefined,
      });
      return after;
    }).catch((error) => {
      if (error instanceof AdminError) throw error;
      throw new AdminError(
        "CLAUDE_AGENT_POLICY_STORE_UNAVAILABLE",
        "Claude Agent desired configuration could not be saved",
        503,
      );
    });
    return Response.json({ data: { desired } }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
