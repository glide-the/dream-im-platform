// [Input] Mocked Admin guards/database/audit and protected Dream diagnostics responses.
// [Output] RBAC, fail-closed storage, strict DTO, transaction, and privacy regression coverage.
// [Pos] Focused contract tests for the dedicated Claude Agent resource domain.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  fetchDreamClaudeAgentDiagnostics,
  handleClaudeAgentResourcesGet,
  handleClaudeAgentResourcesPatch,
} from "./claude-agent-resources";

const effective = {
  max_concurrent_runs: 1,
  run_memory_budget_mib: 512,
  memory_reserve_mib: 128,
  retry_after_seconds: 60,
  required_headroom_bytes: 671088640,
};

const diagnostics = {
  schema_version: 1,
  backend_status: "ok",
  scope: { active_runs: "process", counters: "process_lifetime", reset_on_restart: true },
  config: {
    defaults: effective,
    environment: { max_concurrent_runs: null, run_memory_budget_mib: null, memory_reserve_mib: null, retry_after_seconds: null },
    effective,
    effective_version: "env-v1",
    loaded_at: "2026-08-27T06:00:00.000Z",
    restart_required: false,
  },
  turns: { started_total: 8, completed_total: 4, failed_total: 2, cancelled_total: 2 },
  admission: { active_runs: 0, max_concurrent_runs: 1, granted_total: 8, capacity_denials_total: 3, memory_pressure_denials_total: 5, last_denial_type: "memory_pressure", last_denial_at: "2026-08-27T06:01:00.000Z", can_start_new_agent: false },
  claude_processes: { available: true, count: 1, total_rss_bytes: 1048576 },
  memory: { host_available_bytes: 1, cgroup_current_bytes: 2, cgroup_max_bytes: 3, cgroup_raw_headroom_bytes: 1, inactive_file_bytes: 4, slab_reclaimable_bytes: 5, cgroup_reclaimable_bytes: 9, cgroup_effective_headroom_bytes: 10, required_headroom_bytes: 671088640, events: { low: 0, high: 0, max: 1, oom: 0, oom_kill: 0 } },
  sample: { status: "ok", sampled_at: "2026-08-27T06:02:00.000Z", age_seconds: 1, stale: false, error_code: null },
};

describe("Claude Agent Admin resource domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DREAM_DIAGNOSTICS_BASE_URL", "http://127.0.0.1:8765");
    vi.stubEnv("DREAM_DIAGNOSTICS_TOKEN", "x".repeat(32));
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.query.mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (callback) => await callback({ query: mocks.query }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires system.read and keeps desired visible when Dream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "system.read");
    const body = await response.json();
    expect(body.data.runtime).toBeNull();
    expect(body.data.runtimeError.code).toBe("DREAM_DIAGNOSTICS_UNAVAILABLE");
    expect(body.data.application.status).toBe("unknown");
  });

  it("fails closed with 503 when the policy store is unavailable", async () => {
    mocks.query.mockRejectedValueOnce(new Error("database offline"));
    const dreamFetch = vi.fn();
    vi.stubGlobal("fetch", dreamFetch);
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CLAUDE_AGENT_POLICY_STORE_UNAVAILABLE");
    expect(dreamFetch).not.toHaveBeenCalled();
  });

  it("does not forward Admin cookies and strips unknown Dream fields", async () => {
    const dreamFetch = vi.fn().mockResolvedValue(Response.json({ ...diagnostics, transcript: "must-not-pass" }));
    vi.stubGlobal("fetch", dreamFetch);
    const parsed = await fetchDreamClaudeAgentDiagnostics();
    expect(parsed).not.toHaveProperty("transcript");
    const init = dreamFetch.mock.calls[0][1];
    expect(init.headers).toEqual({ accept: "application/json", authorization: `Bearer ${"x".repeat(32)}` });
    expect(init.headers).not.toHaveProperty("cookie");
  });

  it("accepts an unavailable can-start observation as null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ...diagnostics,
      admission: { ...diagnostics.admission, can_start_new_agent: null },
      sample: { ...diagnostics.sample, stale: true },
    })));
    const parsed = await fetchDreamClaudeAgentDiagnostics();
    expect(parsed.admission.can_start_new_agent).toBeNull();
    expect(parsed.sample.stale).toBe(true);
  });

  it("reports desired as applied only when all effective thresholds match", async () => {
    const desired = { schemaVersion: 1, revision: 2, maxConcurrentRuns: 1, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 };
    mocks.query.mockResolvedValueOnce({ rows: [{ value: desired, updated_at: "2026-08-27T06:00:00.000Z" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(diagnostics)));
    const response = await handleClaudeAgentResourcesGet(new Request("https://admin.test/api/admin/claude-agent-resources"));
    const body = await response.json();
    expect(body.data.application).toEqual({ status: "applied", applied: true, restartRequired: false });
  });

  it("rejects unknown and out-of-bound policy fields before opening a transaction", async () => {
    const response = await handleClaudeAgentResourcesPatch(new Request("https://admin.test/api/admin/claude-agent-resources", {
      method: "PATCH",
      headers: { origin: "https://admin.test", "content-type": "application/json" },
      body: JSON.stringify({ maxConcurrentRuns: 0, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60, disableGate: true }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.assertAdminMutationOrigin).toHaveBeenCalled();
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "system.write");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("locks, increments revision, and records before/after in the same transaction", async () => {
    const before = { schemaVersion: 1, revision: 4, maxConcurrentRuns: 1, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 };
    const after = { ...before, revision: 5, maxConcurrentRuns: 2 };
    mocks.query
      .mockResolvedValueOnce({ rows: [{ value: before, updated_at: "2026-08-27T06:00:00.000Z" }] })
      .mockResolvedValueOnce({ rows: [{ value: after, updated_at: "2026-08-27T06:05:00.000Z" }] });
    const response = await handleClaudeAgentResourcesPatch(new Request("https://admin.test/api/admin/claude-agent-resources", {
      method: "PATCH",
      headers: { origin: "https://admin.test", "content-type": "application/json" },
      body: JSON.stringify({ maxConcurrentRuns: 2, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 }),
    }));
    expect(response.status).toBe(200);
    expect(String(mocks.query.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "update",
      before: expect.objectContaining({ revision: 4 }),
      after: expect.objectContaining({ revision: 5 }),
    }));
  });

  it("rejects denied mutation origins before any database write", async () => {
    mocks.assertAdminMutationOrigin.mockImplementationOnce(() => {
      throw new AdminError("ADMIN_ORIGIN_DENIED", "origin", 403);
    });
    const response = await handleClaudeAgentResourcesPatch(new Request("https://admin.test/api/admin/claude-agent-resources", {
      method: "PATCH",
      headers: { origin: "https://evil.test", "content-type": "application/json" },
      body: JSON.stringify({ maxConcurrentRuns: 1, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.requireAdminRequest).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("propagates audit failure so the enclosing transaction can roll back", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: { schemaVersion: 1, revision: 1, maxConcurrentRuns: 1, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 }, updated_at: "2026-08-27T06:05:00.000Z" }] });
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await handleClaudeAgentResourcesPatch(new Request("https://admin.test/api/admin/claude-agent-resources", {
      method: "PATCH",
      headers: { origin: "https://admin.test", "content-type": "application/json" },
      body: JSON.stringify({ maxConcurrentRuns: 1, runMemoryBudgetMib: 512, memoryReserveMib: 128, retryAfterSeconds: 60 }),
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
