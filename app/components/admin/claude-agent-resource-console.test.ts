// [Input] Claude Agent console refresh, admission-state, env-name, and desired-policy helpers.
// [Output] Cancellable fetch and read-only AutoDL handoff regression coverage.
// [Pos] Node-safe focused tests for the Admin resource console client contract.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDreamAutoDlPolicyProjection,
  CLAUDE_AGENT_ENV_FIELDS,
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  fetchClaudeAgentResources,
  formatCanStartNewAgent,
} from "./ClaudeAgentResourceConsole";

describe("Claude Agent resource console data client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the ten-second refresh contract", () => {
    expect(CLAUDE_AGENT_REFRESH_INTERVAL_MS).toBe(10_000);
  });

  it("passes the React Query cancellation signal to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { application: { status: "unknown" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchClaudeAgentResources(controller.signal);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/claude-agent-resources", expect.objectContaining({ signal: controller.signal }));
  });

  it("shows unavailable instead of denial for stale or unknown admission observations", () => {
    expect(formatCanStartNewAgent(null, false)).toBe("不可用");
    expect(formatCanStartNewAgent(false, true)).toBe("不可用");
    expect(formatCanStartNewAgent(false, false)).toBe("拒绝");
    expect(formatCanStartNewAgent(true, false)).toBe("允许");
  });

  it("exposes all four Dream env names and builds a read-only AutoDL handoff", () => {
    expect(CLAUDE_AGENT_ENV_FIELDS.map((field) => field.dreamEnv)).toEqual([
      "INK_AGENT_MAX_CONCURRENT_RUNS",
      "INK_AGENT_RUN_MEMORY_BUDGET_MIB",
      "INK_AGENT_MEMORY_RESERVE_MIB",
      "INK_AGENT_SWEEP_INTERVAL_S",
    ]);
    expect(buildDreamAutoDlPolicyProjection({
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 768,
      memoryReserveMib: 192,
      retryAfterSeconds: 45,
    })).toBe([
      "AUTODL_AGENT_MAX_CONCURRENT_RUNS=2",
      "AUTODL_AGENT_RUN_MEMORY_BUDGET_MIB=768",
      "AUTODL_AGENT_MEMORY_RESERVE_MIB=192",
      "AUTODL_AGENT_RETRY_AFTER_SECONDS=45",
    ].join("\n"));
  });
});
