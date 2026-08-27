// [Input] Claude Agent console refresh, cancellation, admission-state, and policy-field helpers.
// [Output] Ten-second refresh, cancellation, unknown-state, and frozen revision payload coverage.
// [Pos] Node-safe focused tests for the Admin resource console client contract.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_POLICY_FIELDS,
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  fetchClaudeAgentResources,
  formatCanStartNewAgent,
  policyMutationPayload,
} from "./ClaudeAgentResourceConsole";

describe("Claude Agent resource console data client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the ten-second refresh contract", () => {
    expect(CLAUDE_AGENT_REFRESH_INTERVAL_MS).toBe(10_000);
  });

  it("passes the React Query cancellation signal to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { application: { status: "unavailable" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchClaudeAgentResources(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/claude-agent-resources",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("shows unknown instead of denial for stale or nullable admission observations", () => {
    expect(formatCanStartNewAgent(null, false)).toBe("未知");
    expect(formatCanStartNewAgent(false, true)).toBe("未知");
    expect(formatCanStartNewAgent(false, false)).toBe("拒绝");
    expect(formatCanStartNewAgent(true, false)).toBe("允许");
  });

  it("maps all four desired fields directly to PostgreSQL effective values", () => {
    expect(CLAUDE_AGENT_POLICY_FIELDS).toEqual([
      expect.objectContaining({ key: "maxConcurrentRuns", effectiveKey: "max_concurrent_runs" }),
      expect.objectContaining({ key: "runMemoryBudgetMib", effectiveKey: "run_memory_budget_mib" }),
      expect.objectContaining({ key: "memoryReserveMib", effectiveKey: "memory_reserve_mib" }),
      expect.objectContaining({ key: "retryAfterSeconds", effectiveKey: "retry_after_seconds" }),
    ]);
    expect(JSON.stringify(CLAUDE_AGENT_POLICY_FIELDS)).not.toContain("AUTODL");
  });

  it("builds mutation payloads from the revision frozen when editing began", () => {
    const values = {
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    };
    expect(policyMutationPayload(values, 7)).toEqual({ ...values, expectedRevision: 7 });
  });
});
