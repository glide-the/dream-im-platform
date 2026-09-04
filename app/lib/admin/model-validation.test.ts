import { describe, expect, it, vi } from "vitest";

import {
  validateManagedUpstreamModel,
  validateUpstreamModel,
} from "./model-validation";

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
      }),
    );
    const request = fetcher.mock.calls[0][1] as RequestInit;
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer fixture-credential");
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

  it("always uses bearer authentication for OpenAI-compatible providers", async () => {
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => ({ status: 200 }));
    await validateUpstreamModel(
      {
        protocol: "openai",
        baseUrl: "https://api.openai.com",
        upstreamModel: "gpt-fixture",
        credential: "fixture-credential",
      },
      { fetcher },
    );

    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer fixture-credential");
    expect(headers.has("x-api-key")).toBe(false);
  });

  it("uses the model-specific request headers during validation", async () => {
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => ({ status: 200 }));
    await validateUpstreamModel(
      {
        protocol: "openai",
        baseUrl: "https://api.openai.com",
        upstreamModel: "hy3-preview",
        credential: "fixture-credential",
        config: { authMode: "bearer" },
        requestHeaders: { "user-agent": "OpenAI/JS 6.39.1" },
      },
      { fetcher },
    );

    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get("user-agent")).toBe("OpenAI/JS 6.39.1");
    expect(headers.get("authorization")).toBe("Bearer fixture-credential");
  });

  it("validates a managed Codex model through the fixed product resource without exposing its token", async () => {
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => ({ status: 200 }));
    const resolveAccess = vi.fn(async () => ({
      adapterKind: "codex" as const,
      dialect: "openai_responses" as const,
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: new Headers({ authorization: "Bearer managed-secret" }),
      credentialRevision: 4,
      accountId: "managed-account-1",
      accountAuthEpoch: 1,
      defaultRevision: null,
      renewed: false,
    }));
    const result = await validateManagedUpstreamModel(
      {
        providerId: "provider-codex",
        adapterKind: "codex",
        authEpoch: 3,
        managedAccountId: "managed-account-1",
        managedAccountAuthEpoch: 1,
        credentialRevision: 4,
        upstreamModel: "gpt-codex",
      },
      {
        fetcher,
        resolveAccess,
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(125),
        testedAt: () => new Date("2026-09-04T00:00:00.000Z"),
      },
    );

    expect(resolveAccess).toHaveBeenCalledWith(expect.objectContaining({
      adapterKind: "codex",
      authEpoch: 3,
      managedAccountId: "managed-account-1",
      managedAccountAuthEpoch: 1,
      credentialRevision: 4,
    }));
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(new Headers(request.headers).get("authorization")).toBe("Bearer managed-secret");
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gpt-codex",
      stream: true,
      store: false,
    });
    expect(result).toMatchObject({ status: "operational", usable: true, responseTimeMs: 25 });
    expect(JSON.stringify(result)).not.toContain("managed-secret");
  });
});
