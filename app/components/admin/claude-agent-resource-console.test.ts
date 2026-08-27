// [Input] Claude Agent console refresh, cancellation, admission-state, policy-field helpers, and save interaction source.
// [Output] Refresh, safe bounds, direct no-confirm save, invalid no-submit state, and immediate pending projection coverage.
// [Pos] Node-safe focused tests for the Admin resource console client contract.
// [Sync] 2026-08-27: cover uncapped positive concurrency and direct save without a blocking native confirmation.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS,
  CLAUDE_AGENT_POLICY_FIELDS,
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  type ClaudeAgentResourceResponse,
  type PolicyBounds,
  fetchClaudeAgentResources,
  formatCanStartNewAgent,
  policyMutationPayload,
  policySaveButtonState,
  policyValidationErrors,
  projectSavedDesired,
} from "./ClaudeAgentResourceConsole";

const bounds: PolicyBounds = {
  maxConcurrentRuns: { min: 1, max: null },
  runMemoryBudgetMib: { min: 128, max: 8_192 },
  memoryReserveMib: { min: 64, max: 4_096 },
  retryAfterSeconds: { min: 5, max: 3_600 },
};

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
    expect(policySaveButtonState(false, false, false, false)).toEqual({
      disabled: true,
      label: "修改后可保存",
    });
    expect(policySaveButtonState(true, false, false, false)).toEqual({
      disabled: false,
      label: "保存期望配置",
    });
    expect(policySaveButtonState(true, true, false, false)).toEqual({
      disabled: true,
      label: "保存中…",
    });
    expect(policySaveButtonState(true, false, false, true)).toEqual({
      disabled: true,
      label: "请检查输入范围",
    });
  });

  it("submits the explicit save action without a blocking native confirmation", () => {
    const source = readFileSync(new URL("./ClaudeAgentResourceConsole.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("window.confirm");
  });

  it("accepts large positive concurrency without a product max and rejects invalid numbers", () => {
    const valid = {
      maxConcurrentRuns: 1_000_000,
      runMemoryBudgetMib: 416,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
    };
    expect(policyValidationErrors(valid, bounds)).toEqual({});
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: 0 }, bounds)).toEqual({
      maxConcurrentRuns: "请输入不小于 1 的整数",
    });
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: -1 }, bounds)).toEqual({
      maxConcurrentRuns: "请输入不小于 1 的整数",
    });
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: 1.5 }, bounds)).toEqual({
      maxConcurrentRuns: "请输入不小于 1 的整数",
    });
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: Number.MAX_SAFE_INTEGER + 1 }, bounds)).toEqual({
      maxConcurrentRuns: "请输入不小于 1 的整数",
    });
    expect(policyValidationErrors({ ...valid, runMemoryBudgetMib: 416.5 }, bounds)).toEqual({
      runMemoryBudgetMib: "请输入 128–8192 之间的整数",
    });
    expect(policyValidationErrors({ ...valid, memoryReserveMib: 4097 }, bounds)).toEqual({
      memoryReserveMib: "请输入 64–4096 之间的整数",
    });
    expect(policyValidationErrors({ ...valid, retryAfterSeconds: Number.NaN }, bounds)).toEqual({
      retryAfterSeconds: "请输入 5–3600 之间的整数",
    });
  });

  it("translates strict policy rejection into actionable Chinese guidance", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "CLAUDE_AGENT_POLICY_INVALID",
        message: "Claude Agent resource policy is invalid",
      },
    }, { status: 400 })));

    await expect(fetchClaudeAgentResources()).rejects.toThrow(
      "配置未保存：请确认四项阈值都是页面允许范围内的整数。",
    );
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

  it("projects pending after a save even when the last Dream snapshot is unavailable", () => {
    const current = {
      desired: { status: "not_configured", values: null, revision: null, updatedAt: null },
      runtime: null,
      application: { status: "unavailable", applied: null },
    } as unknown as ClaudeAgentResourceResponse;
    const saved = {
      status: "valid" as const,
      values: {
        schemaVersion: 1,
        revision: 1,
        maxConcurrentRuns: 2,
        runMemoryBudgetMib: 416,
        memoryReserveMib: 128,
        retryAfterSeconds: 60,
      },
      revision: 1,
      updatedAt: "2026-08-27T12:20:44.000Z",
    };

    expect(projectSavedDesired(current, saved).application).toEqual({
      status: "pending",
      applied: false,
    });
  });
});
