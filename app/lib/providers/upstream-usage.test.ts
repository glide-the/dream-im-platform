// [Input] Documented monetary/quota payloads and injected HTTP failures.
// [Output] Missing/zero/partial/forbidden parsing evidence without live upstream access.
// [Pos] Usage semantic and credential non-disclosure tests.
import { describe, expect, it, vi } from "vitest";
import { parseUpstreamUsage, queryUpstreamUsage } from "./upstream-usage";
describe("upstream usage", () => {
  it("preserves zero and converts only actual USD fields to integer micro-USD", () => {
    const result = parseUpstreamUsage("openrouter", { data: { usage: 0, limit: 10.123456, limit_remaining: 9.9 } });
    expect(result.status).toBe("partial");
    expect(result.metrics).toEqual(expect.arrayContaining([{ label: "Key 累计支出", value: 0, unit: "USD" }, { label: "Key 消费额度", value: 10_123_456, unit: "USD" }]));
    expect(result.metrics).toHaveLength(3);
    expect(parseUpstreamUsage("openrouter", { data: {} })).toEqual({ status: "missing", metrics: [] });
  });
  it("retains original currency and avoids inventing consumed amounts", () => {
    const result = parseUpstreamUsage("deepseek", { balance_infos: [{ currency: "CNY", total_balance: "0.005", granted_balance: "0", topped_up_balance: "0.005" }] });
    expect(result.status).toBe("ready");
    expect(result.metrics.map((metric) => metric.value)).toEqual([5000, 0, 5000]);
    expect(result.metrics.every((metric) => metric.unit === "CNY")).toBe(true);
  });
  it("keeps Codex rate windows distinct from financial quota and Copilot requests", () => {
    expect(parseUpstreamUsage("codex", { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1791216000 } } })).toMatchObject({ status: "partial", metrics: [{ value: 25, unit: "percent", windowSeconds: 18000, resetAt: expect.any(String) }] });
    expect(parseUpstreamUsage("github_copilot", { quota_reset_date: "2026-11-01", quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 10 }, chat: { unlimited: true }, completions: { unlimited: true } } })).toMatchObject({ status: "ready", metrics: [{ value: 300, unit: "requests" }, { value: 10, unit: "requests" }] });
    expect(parseUpstreamUsage("github_copilot", { quota_snapshots: { premium_interactions: { unlimited: true }, chat: { unlimited: true }, completions: { unlimited: true } } })).toMatchObject({ status: "ready", metrics: [], notes: ["Premium 请求不限量", "Chat 请求不限量", "补全请求不限量"] });
  });
  it("does not echo credential-bearing upstream errors or network details", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("echo-secret", { status: 403 }));
    const input = { source: "openrouter" as const, url: "https://provider.example/api/v1/key", headers: new Headers({ authorization: "Bearer echo-secret" }), timeoutMs: 1000, ttlSeconds: 60 };
    const result = await queryUpstreamUsage(input, { fetcher, now: () => 0 });
    expect(result.status).toBe("forbidden");
    expect(JSON.stringify(result)).not.toContain("echo-secret");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    fetcher.mockRejectedValue(new Error("secret internal hostname"));
    expect(await queryUpstreamUsage(input, { fetcher })).toMatchObject({ status: "failed", metrics: [] });
  });
});
