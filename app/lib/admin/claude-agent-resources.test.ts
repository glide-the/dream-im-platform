// [Input] Mocked Admin guards, PostgreSQL projection rows, transactions, and audit writes.
// [Output] RBAC, read/write capability gates, freshness, strict DTO, optimistic concurrency, and rollback coverage.
// [Pos] Focused contract tests for the PostgreSQL-only Claude Agent resource Admin domain.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../platform-db", () => ({
  withPlatformClient: async (callback: (client: { query: typeof mocks.query }) => unknown) =>
    await callback({ query: mocks.query }),
  withPlatformTransaction: mocks.transaction,
}));
vi.mock("./guard", () => ({
  adminRequestId: () => "admin_agent_resource_test",
  requireAdminRequest: mocks.requireAdminRequest,
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
}));
vi.mock("./audit", () => ({ recordAdminAuditOnClient: mocks.audit }));

import { AdminError } from "./errors";
import {
  claudeAgentResourceSnapshotSchema,
  handleClaudeAgentResourcesGet,
  handleClaudeAgentResourcesPatch,
} from "./claude-agent-resources";

const desired = {
  schemaVersion: 1,
  revision: 2,
  maxConcurrentRuns: 1,
  runMemoryBudgetMib: 512,
  memoryReserveMib: 128,
  retryAfterSeconds: 60,
};

const effective = {
  max_concurrent_runs: 1,
  run_memory_budget_mib: 512,
  memory_reserve_mib: 128,
  retry_after_seconds: 60,
  required_headroom_bytes: 671_088_640,
};

const snapshot = {
  schema_version: 1,
  backend_status: "ok",
  scope: { active_runs: "process", counters: "process_lifetime", reset_on_restart: true },
  config: {
    defaults: effective,
    effective,
    effective_version: "policy-v2",
    loaded_at: "2026-08-27T06:00:00.000Z",
    policy_status: "applied",
    policy_revision: 2,
    policy_updated_at: "2026-08-27T05:59:00.000Z",
  },
  turns: { started_total: 8, completed_total: 4, failed_total: 2, cancelled_total: 2 },
  admission: {
    active_runs: 0,
    max_concurrent_runs: 1,
    granted_total: 8,
    capacity_denials_total: 3,
    memory_pressure_denials_total: 5,
    last_denial_type: "memory_pressure",
    last_denial_at: "2026-08-27T06:01:00.000Z",
    can_start_new_agent: false,
  },
  claude_processes: { available: true, count: 1, total_rss_bytes: 1_048_576 },
  memory: {
    host_available_bytes: 1,
    cgroup_current_bytes: 2,
    cgroup_max_bytes: 3,
    cgroup_raw_headroom_bytes: 1,
    inactive_file_bytes: 4,
    slab_reclaimable_bytes: 5,
    cgroup_reclaimable_bytes: 9,
    cgroup_effective_headroom_bytes: 10,
    required_headroom_bytes: 671_088_640,
    events: { low: 0, high: 0, max: 1, oom: 0, oom_kill: 0 },
  },
  sample: {
    status: "ok",
    sampled_at: "2026-08-27T06:02:00.000Z",
    stale: false,
    error_code: null,
  },
  pipeline: { queue_dropped_total: 1, write_errors_total: 0, last_write_error_at: null },
};

const capabilityRow = {
  version: 1,
  contract_sha256: "db2ba80eb61a9515ba23000f8a615fb41f6ed5824bd306e8d0ca5fb8f1cc044e",
};

function projection(overrides: Record<string, unknown> = {}) {
  return {
    desired_value: desired,
    desired_updated_at: "2026-08-27T05:59:00.000Z",
    instance_id: "instance_test",
    process_started_at: "2026-08-27T05:00:00.000Z",
    heartbeat_at: "2026-08-27T06:02:10.000Z",
    sampled_at: "2026-08-27T06:02:00.000Z",
    snapshot,
    heartbeat_age_seconds: 10,
    sample_age_seconds: 20,
    ...overrides,
  };
}

function mockGetProjection(row: ReturnType<typeof projection>) {
  mocks.query
    .mockResolvedValueOnce({ rows: [capabilityRow] })
    .mockResolvedValueOnce({ rows: [row] });
}

function patchRequest(body: Record<string, unknown>) {
  return new Request("https://admin.test/api/admin/claude-agent-resources", {
    method: "PATCH",
    headers: { origin: "https://admin.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Claude Agent Admin resource domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.query.mockImplementation(async (statement) => ({
      rows: String(statement).includes("FROM drizzle.schema_capabilities")
        ? [capabilityRow]
        : [projection()],
    }));
    mocks.transaction.mockImplementation(async (callback) => await callback({ query: mocks.query }));
  });

  it("requires system.read and reads only the PostgreSQL projection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "system.read");
    expect(String(mocks.query.mock.calls[0][0])).toContain("drizzle.schema_capabilities");
    expect(String(mocks.query.mock.calls[1][0])).toContain("claude_agent_resource_snapshots");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("fails closed when the exact database capability is absent or drifted", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const missing = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.code).toBe("CLAUDE_AGENT_RESOURCE_CAPABILITY_UNAVAILABLE");

    mocks.query.mockResolvedValueOnce({ rows: [{ ...capabilityRow, contract_sha256: "0".repeat(64) }] });
    const drifted = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(drifted.status).toBe(503);
    expect((await drifted.json()).error.code).toBe("CLAUDE_AGENT_RESOURCE_CAPABILITY_MISMATCH");
  });

  it("fails closed when PostgreSQL is unavailable", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database offline"));
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CLAUDE_AGENT_RESOURCE_STORE_UNAVAILABLE");
  });

  it("uses a strict content-free snapshot schema", () => {
    expect(claudeAgentResourceSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(claudeAgentResourceSnapshotSchema.safeParse({ ...snapshot, transcript: "must-not-pass" }).success).toBe(false);
    expect(claudeAgentResourceSnapshotSchema.safeParse({
      ...snapshot,
      admission: { ...snapshot.admission, thread_id: "must-not-pass" },
    }).success).toBe(false);
  });

  it("returns unavailable for an absent or invalid latest snapshot", async () => {
    mockGetProjection(projection({
      instance_id: null,
      process_started_at: null,
      heartbeat_at: null,
      sampled_at: null,
      snapshot: null,
      heartbeat_age_seconds: null,
      sample_age_seconds: null,
    }));
    const absent = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    const absentBody = await absent.json();
    expect(absentBody.data.runtime).toBeNull();
    expect(absentBody.data.application.status).toBe("unavailable");

    mockGetProjection(projection({ snapshot: { ...snapshot, hostname: "private" } }));
    const invalid = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    const invalidBody = await invalid.json();
    expect(invalidBody.data.runtime).toBeNull();
    expect(invalidBody.data.runtimeError.code).toBe("CLAUDE_AGENT_RESOURCE_SNAPSHOT_INVALID");
    expect(JSON.stringify(invalidBody)).not.toContain("private");
  });

  it("shows invalid desired data without projecting it as effective", async () => {
    mockGetProjection(projection({ desired_value: { ...desired, disableGate: true } }));
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    const body = await response.json();
    expect(body.data.desired).toMatchObject({ status: "invalid", values: null, revision: 2 });
    expect(body.data.application.status).toBe("invalid");
  });

  it("requires both desired values and revision to report applied", async () => {
    const applied = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect((await applied.json()).data.application).toEqual({ status: "applied", applied: true });

    mockGetProjection(projection({ snapshot: { ...snapshot, config: { ...snapshot.config, policy_revision: 1 } } }));
    const pending = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect((await pending.json()).data.application).toEqual({ status: "pending", applied: false });
  });

  it("uses DB-computed heartbeat age and nulls can-start outside fresh state", async () => {
    mockGetProjection(projection({ heartbeat_age_seconds: 20 }));
    const fresh = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect((await fresh.json()).data.runtime).toMatchObject({ freshness: "fresh", admission: { can_start_new_agent: false } });

    mockGetProjection(projection({ heartbeat_age_seconds: 60 }));
    const stale = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect((await stale.json()).data.runtime).toMatchObject({ freshness: "stale", admission: { can_start_new_agent: null } });

    mockGetProjection(projection({ heartbeat_age_seconds: 60.01 }));
    const offline = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    const offlineBody = await offline.json();
    expect(offlineBody.data.runtime).toMatchObject({ freshness: "offline", admission: { can_start_new_agent: null } });
    expect(offlineBody.data.application.status).toBe("unavailable");
  });

  it("rejects unknown and out-of-bound policy fields before opening a transaction", async () => {
    const response = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 0,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
      disableGate: true,
    }));
    expect(response.status).toBe(400);
    expect(mocks.assertAdminMutationOrigin).toHaveBeenCalled();
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "system.write");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("locks, checks expectedRevision, increments, upserts, and audits in one transaction", async () => {
    const after = { ...desired, revision: 3, maxConcurrentRuns: 2 };
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [capabilityRow] })
      .mockResolvedValueOnce({ rows: [{ value: desired, updated_at: "2026-08-27T05:59:00.000Z" }] })
      .mockResolvedValueOnce({ rows: [{ value: after, updated_at: "2026-08-27T06:05:00.000Z" }] });
    const response = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(response.status).toBe(200);
    expect(String(mocks.query.mock.calls[0][0])).toContain("pg_advisory_xact_lock");
    expect(String(mocks.query.mock.calls[1][0])).toContain("drizzle.schema_capabilities");
    expect(String(mocks.query.mock.calls[2][0])).toContain("FOR UPDATE");
    expect(String(mocks.query.mock.calls[3][0])).toContain("ON CONFLICT");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      before: desired,
      after,
    }));
  });

  it("returns 409 on an optimistic revision conflict without writing or auditing", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [capabilityRow] })
      .mockResolvedValueOnce({ rows: [{ value: desired, updated_at: "2026-08-27T05:59:00.000Z" }] });
    const response = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 1,
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CLAUDE_AGENT_POLICY_REVISION_CONFLICT");
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("fails closed before desired writes when the PATCH capability is absent or drifted", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const missing = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 1,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(missing.status).toBe(503);
    expect((await missing.json()).error.code).toBe("CLAUDE_AGENT_RESOURCE_CAPABILITY_UNAVAILABLE");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.transaction.mockImplementation(async (callback) => await callback({ query: mocks.query }));
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...capabilityRow, version: 2 }] });
    const drifted = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 1,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(drifted.status).toBe(503);
    expect((await drifted.json()).error.code).toBe("CLAUDE_AGENT_RESOURCE_CAPABILITY_MISMATCH");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("rejects denied origins before auth or database access", async () => {
    mocks.assertAdminMutationOrigin.mockImplementationOnce(() => {
      throw new AdminError("ADMIN_ORIGIN_DENIED", "origin", 403);
    });
    const response = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 1,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(response.status).toBe(403);
    expect(mocks.requireAdminRequest).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("propagates audit failure so the transaction can roll back", async () => {
    const after = { ...desired, revision: 3 };
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [capabilityRow] })
      .mockResolvedValueOnce({ rows: [{ value: desired, updated_at: "2026-08-27T05:59:00.000Z" }] })
      .mockResolvedValueOnce({ rows: [{ value: after, updated_at: "2026-08-27T06:05:00.000Z" }] });
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await handleClaudeAgentResourcesPatch(patchRequest({
      expectedRevision: 2,
      maxConcurrentRuns: 1,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    }));
    expect(response.status).toBe(503);
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it("fails closed when authentication rejects the request", async () => {
    mocks.requireAdminRequest.mockRejectedValue(new AdminError("ADMIN_AUTH_REQUIRED", "login", 401));
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
