import { describe, expect, it, vi } from "vitest";

import { validateUpstreamModel } from "./model-validation";

describe("model validation", () => {
  it("validates an Anthropic-compatible model without exposing response content", async () => {
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => ({ status: 200 }));
    const result = await validateUpstreamModel(
      {
        protocol: "anthropic",
        baseUrl: "https://api.deepseek.com/anthropic",
        upstreamModel: "deepseek-v4-pro",
        credential: "fixture-credential",
        config: { authMode: "bearer" },
      },
      {
        fetcher,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(132),
        testedAt: () => new Date("2026-08-08T00:00:00.000Z"),
      },
    );

    expect(result).toEqual({
      status: "operational",
      usable: true,
      responseTimeMs: 32,
      httpStatus: 200,
      testedAt: "2026-08-08T00:00:00.000Z",
      message: "凭据与上游模型验证通过",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.deepseek.com/anthropic/v1/messages",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: expect.objectContaining({ authorization: "Bearer fixture-credential" }),
      }),
    );
    const request = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "deepseek-v4-pro",
      max_tokens: 1,
      stream: false,
    });
    expect(JSON.stringify(result)).not.toContain("fixture-credential");
  });

  it("classifies credential, throttling and network failures without reading bodies", async () => {
    const unauthorized = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => ({ status: 401 }) },
    );
    expect(unauthorized).toMatchObject({ status: "failed", usable: false, httpStatus: 401 });

    const throttled = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => ({ status: 429 }) },
    );
    expect(throttled).toMatchObject({ status: "degraded", usable: false, httpStatus: 429 });

    const unavailable = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => { throw new TypeError("network detail"); } },
    );
    expect(unavailable).toMatchObject({ status: "failed", usable: false, message: "无法连接模型上游" });
  });
});
