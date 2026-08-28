// [Input] Claude Agent console refresh, cancellation, admission-state, policy-field helpers, and save interaction source.
// [Output] Strict field picking, technical bounds, field-error mapping, direct save, refetch, and pending coverage.
// [Pos] Node-safe focused tests for the Admin resource console client contract.
// [Sync] 2026-08-28: cover uncapped resource values, nullable Runtime effort, no dialogs, and active refetch.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLAUDE_AGENT_POLICY_SAVE_BUTTON_CLASS,
  CLAUDE_AGENT_POLICY_FIELDS,
  CLAUDE_AGENT_REFRESH_INTERVAL_MS,
  ClaudeAgentPolicyRequestError,
  type ClaudeAgentResourceResponse,
  type PolicyBounds,
  type PolicyTechnicalLimits,
  fetchClaudeAgentResources,
  formatCanStartNewAgent,
  policyFieldErrorsFromDetails,
  policyMutationPayload,
  policySaveButtonState,
  policyValidationErrors,
  policyValuesFromDesired,
  projectSavedDesired,
} from "./ClaudeAgentResourceConsole";

const bounds: PolicyBounds = {
  maxConcurrentRuns: { min: 1, max: null },
  runMemoryBudgetMib: { min: 1, max: null },
  memoryReserveMib: { min: 1, max: null },
  retryAfterSeconds: { min: 1, max: null },
};
const technicalLimits: PolicyTechnicalLimits = {
  mibInBytes: 1_048_576,
  maxCombinedMemoryMib: Math.floor(Number.MAX_SAFE_INTEGER / 1_048_576),
  claudeCodeRuntimeIntegerMax: 2_147_483_647,
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

  it("picks resource and Runtime fields with the frozen revision from desired", () => {
    const values = {
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
      claudeCodeEffortLevel: "high" as const,
      schemaVersion: 1,
      revision: 7,
    };
    expect(policyValuesFromDesired(values)).toEqual({
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
      claudeCodeEffortLevel: "high",
    });
    expect(policyMutationPayload(values, 7)).toEqual({
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: 512,
      memoryReserveMib: 128,
      retryAfterSeconds: 60,
      claudeCodeEffortLevel: "high",
      expectedRevision: 7,
    });
    expect(policyMutationPayload(values, 7)).not.toHaveProperty("schemaVersion");
    expect(policyMutationPayload(values, 7)).not.toHaveProperty("revision");
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

  it("has no native dialog, persistent helper, or implicit invalidation-only save", () => {
    const source = readFileSync(new URL("./ClaudeAgentResourceConsole.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/);
    expect(source).not.toContain("仅限整数");
    expect(source).not.toContain("无产品上限");
    expect(source).not.toContain("保存只更新 PostgreSQL desired");
    expect(source).not.toContain("不直连 Dream");
    expect(source).not.toContain("PostgreSQL observer snapshot");
    expect(source).not.toContain("等待 Dream 下次定时读取后生效");
    expect(source).toContain("期望配置已保存，正在等待应用");
    expect(source).toContain("queryClient.refetchQueries");
    expect(source).toContain('type: "active"');
  });

  it("accepts all four values above old product maxima and rejects non-positive or unsafe values", () => {
    const valid = {
      maxConcurrentRuns: 1_000_000,
      runMemoryBudgetMib: 9_000,
      memoryReserveMib: 5_000,
      retryAfterSeconds: 4_000,
      claudeCodeEffortLevel: null,
    };
    expect(policyValidationErrors(valid, bounds, technicalLimits)).toEqual({});
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: 0 }, bounds, technicalLimits)).toEqual({
      maxConcurrentRuns: "请输入有效的正整数",
    });
    expect(policyValidationErrors({ ...valid, runMemoryBudgetMib: 0 }, bounds, technicalLimits)).toEqual({
      runMemoryBudgetMib: "请输入有效的正整数",
    });
    expect(policyValidationErrors({ ...valid, memoryReserveMib: -1 }, bounds, technicalLimits)).toEqual({
      memoryReserveMib: "请输入有效的正整数",
    });
    expect(policyValidationErrors({ ...valid, retryAfterSeconds: 1.5 }, bounds, technicalLimits)).toEqual({
      retryAfterSeconds: "请输入有效的正整数",
    });
    expect(policyValidationErrors({ ...valid, maxConcurrentRuns: Number.MAX_SAFE_INTEGER + 1 }, bounds, technicalLimits)).toEqual({
      maxConcurrentRuns: "请输入有效的正整数",
    });
  });

  it("rejects memory values whose combined byte requirement is not a safe integer", () => {
    const errors = policyValidationErrors({
      maxConcurrentRuns: 2,
      runMemoryBudgetMib: technicalLimits.maxCombinedMemoryMib,
      memoryReserveMib: 1,
      retryAfterSeconds: 1,
      claudeCodeEffortLevel: null,
    }, bounds, technicalLimits);
    expect(errors).toEqual({
      runMemoryBudgetMib: "内存合计过大",
      memoryReserveMib: "内存合计过大",
    });
  });

  it("maps recognized API issue paths to fields and leaves unknown paths global", async () => {
    expect(policyFieldErrorsFromDetails([
      { path: ["runMemoryBudgetMib"], code: "combined_memory_unsafe" },
      { path: ["memoryReserveMib"], code: "combined_memory_unsafe" },
      { path: ["maxConcurrentRuns"], code: "invalid_value" },
      { path: ["privateField"], code: "invalid_value" },
    ])).toEqual({
      maxConcurrentRuns: "请输入有效的正整数",
      runMemoryBudgetMib: "内存合计过大",
      memoryReserveMib: "内存合计过大",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: {
        code: "CLAUDE_AGENT_POLICY_INVALID",
        message: "Claude Agent resource policy is invalid",
        details: [{ path: ["retryAfterSeconds"], code: "invalid_value" }],
      },
    }, { status: 400 })));

    await expect(fetchClaudeAgentResources()).rejects.toEqual(
      expect.objectContaining<Partial<ClaudeAgentPolicyRequestError>>({
        message: "配置未保存",
        fieldErrors: { retryAfterSeconds: "请输入有效的正整数" },
      }),
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
        claudeCodeEffortLevel: "high" as const,
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
        claudeCodeEffortLevel: null,
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
