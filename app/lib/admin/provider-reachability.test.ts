import { describe, expect, it, vi } from "vitest";

import { probeProviderReachability } from "./provider-reachability";

describe("provider reachability", () => {
  it("treats any received HTTP status as reachable without reading a body", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 401 });
    const ticks = [1_000, 1_042];

    const result = await probeProviderReachability(
      { protocol: "anthropic", baseUrl: "https://api.deepseek.com/anthropic" },
      {
        fetcher,
        now: () => ticks.shift() ?? 1_042,
        testedAt: () => new Date("2026-08-08T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      status: "operational",
      reachable: true,
      responseTimeMs: 42,
      httpStatus: 401,
      testedAt: "2026-08-08T00:00:00.000Z",
      message: "Provider 网络可达",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.deepseek.com/anthropic",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("reports network failures without leaking the upstream exception", async () => {
    const fetcher = vi.fn().mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND secret.internal.example"),
    );

    const result = await probeProviderReachability(
      { protocol: "openai", baseUrl: "https://api.openai.com" },
      {
        fetcher,
        now: () => 1_000,
        testedAt: () => new Date("2026-08-08T00:00:00.000Z"),
      },
    );

    expect(result.reachable).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.message).toBe("Provider 无法建立网络连接");
    expect(JSON.stringify(result)).not.toContain("secret.internal.example");
  });

  it("marks slow response headers as degraded", async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 503 });
    const ticks = [1_000, 7_001];
    const result = await probeProviderReachability(
      { protocol: "anthropic", baseUrl: "https://api.anthropic.com" },
      {
        fetcher,
        now: () => ticks.shift() ?? 7_001,
        testedAt: () => new Date("2026-08-08T00:00:00.000Z"),
      },
    );

    expect(result.status).toBe("degraded");
    expect(result.reachable).toBe(true);
    expect(result.httpStatus).toBe(503);
  });
});
