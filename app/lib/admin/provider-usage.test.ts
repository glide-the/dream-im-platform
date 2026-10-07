// [Input] Named revision keys and safe quota loader results.
// [Output] Coalescing, revision invalidation and visible stale-success preservation.
// [Pos] Process-cache optimization tests; no database fallback or real Provider call.
import { describe, expect, it, vi } from "vitest";
import { coalescedProviderUsage } from "./provider-usage";
import type { UpstreamUsage } from "../providers/upstream-usage";
const result = (expiresAt: string): UpstreamUsage => ({ status: "ready", source: "deepseek", metrics: [{ label: "账户余额", value: 1000, unit: "USD" }], queriedAt: new Date(0).toISOString(), expiresAt });
describe("provider usage cache", () => {
  it("coalesces concurrent reads and isolates credential revisions", async () => {
    const loader = vi.fn(async () => result(new Date(Date.now() + 60000).toISOString()));
    const reads = await Promise.all([coalescedProviderUsage("cache-test", "revision-1", loader), coalescedProviderUsage("cache-test", "revision-1", loader)]);
    expect(reads[0]).toEqual(reads[1]); expect(loader).toHaveBeenCalledTimes(1);
    await coalescedProviderUsage("cache-test", "revision-1", loader); expect(loader).toHaveBeenCalledTimes(1);
    await coalescedProviderUsage("cache-test", "revision-2", loader); expect(loader).toHaveBeenCalledTimes(2);
  });
  it("preserves expired real values while reporting a failed refresh", async () => {
    await coalescedProviderUsage("stale-test", "same", async () => result(new Date(0).toISOString()));
    const failure: UpstreamUsage = { ...result(new Date(0).toISOString()), status: "failed", metrics: [], message: "查询失败" };
    expect(await coalescedProviderUsage("stale-test", "same", async () => failure)).toMatchObject({ status: "failed", stale: true, metrics: [{ value: 1000 }], message: "查询失败" });
  });
});
