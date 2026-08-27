// [Input] Claude Agent console refresh, cancellation, admission-state, and policy-field helpers.
// [Output] Refresh, cancellation, visible save control, immediate desired projection, and revision coverage.
// [Pos] Node-safe focused tests for the Admin resource console client contract.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS,
  CLAUDE_AGENT_POLICY_FIELDS,
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  type ClaudeAgentResourceResponse,
  fetchClaudeAgentResources,
  formatCanStartNewAgent,
  policyMutationPayload,
  policySaveButtonState,
  projectSavedDesired,
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

  it("keeps the primary action readable and disabled until a draft exists", () => {
    expect(CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS).toContain("bg-text-primary");
    expect(CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS).toContain("text-bg-surface");
    expect(CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS).not.toContain("text-background");
    expect(policySaveButtonState(false, false, false)).toEqual({
      disabled: true,
      label: "修改后可保存",
    });
    expect(policySaveButtonState(true, false, false)).toEqual({
      disabled: false,
      label: "保存期望配置",
    });
    expect(policySaveButtonState(true, true, false)).toEqual({
      disabled: true,
      label: "保存中…",
    });
  });

  it("projects a successful desired write immediately while effective remains pending", () => {
    const current = {
      desired: { status: "valid", values: null, revision: 1, updatedAt: null },
      runtime: { freshness: "fresh", config: { effective: { max_concurrent_runs: 1 } } },
      application: { status: "applied", applied: true },
    } as unknown as ClaudeAgentResourceResponse;
    const saved = {
      status: "valid" as const,
      values: {
        schemaVersion: 1,
        revision: 2,
        maxConcurrentRuns: 10,
        runMemoryBudgetMib: 416,
        memoryReserveMib: 128,
        retryAfterSeconds: 60,
      },
      revision: 2,
      updatedAt: "2026-08-27T12:20:44.000Z",
    };

    const projected = projectSavedDesired(current, saved);

    expect(projected.desired).toEqual(saved);
    expect(projected.application).toEqual({ status: "pending", applied: false });
    expect(projected.runtime?.config.effective.max_concurrent_runs).toBe(1);
    expect(current.desired.revision).toBe(1);
  });
});
