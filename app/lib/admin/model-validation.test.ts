// [Input] Static/managed validation contracts, bounded real response streams, and injected Provider access.
// [Output] Provider-free success/failure evidence including redaction and concrete upstream rejection reasons.
// [Pos] Admin model-validation domain regression; no credentials or business database are used.
// [Sync] 2026-10-02: cover JSON/text failure diagnostics and successful stream cancellation.
// [Sync] 2026-10-02: validate the effective model-scoped Codex client metadata used by Gateway.

import { describe, expect, it, vi } from "vitest";

import {
  validateManagedUpstreamModel,
  validateUpstreamModel,
} from "./model-validation";

describe("model validation", () => {
  it.each([200, 400])("sends Codex model client metadata with Provider-owned auth for HTTP %s", async (httpStatus) => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({ status: httpStatus }));
    const result = await validateManagedUpstreamModel(
      {
        providerId: "provider-fixture", adapterKind: "codex", authEpoch: 1,
        managedAccountId: "managed-account-1", managedAccountAuthEpoch: 1,
        credentialRevision: 4, upstreamModel: "gpt-fixture",
        requestHeaders: { "User-Agent": "compatible-client/2", version: "2", "chatgpt-account-id": "other-account" },
      },
      {
        resolveAccess: async () => ({
          adapterKind: "codex", dialect: "openai_responses",
          url: "https://chatgpt.com/backend-api/codex/responses",
          headers: new Headers({ authorization: "Bearer owned-fixture", "chatgpt-account-id": "managed-account-1", "user-agent": "default-client/1", version: "1" }),
          credentialRevision: 4, accountId: "managed-account-1", accountAuthEpoch: 1, defaultRevision: null, renewed: false,
        }),
        fetcher,
      },
    );
    const headers = new Headers(fetcher.mock.calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer owned-fixture");
    expect(headers.get("chatgpt-account-id")).toBe("managed-account-1");
    expect(headers.get("user-agent")).toBe("compatible-client/2");
    expect(headers.get("version")).toBe("2");
    expect(result).toMatchObject({ httpStatus, usable: httpStatus === 200 });
  });

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

  it("classifies credential, throttling and network failures when no diagnostic body is available", async () => {
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

  it.each([
    { body: { detail: "Model unavailable for fixture-credential" }, message: "Model unavailable for [REDACTED]" },
    { body: { error: { message: "Unsupported model", access_token: "fixture-credential" } }, message: "Unsupported model" },
    { body: "Rejected Bearer fixture-credential\n", message: "Rejected [REDACTED]\n" },
  ])("returns a credential-redacted upstream reason for a static model rejection: $message", async ({ body, message }) => {
    const result = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 400, headers: { "x-request-id": "upstream-request-1" } }) },
    );
    expect(result).toMatchObject({ status: "failed", usable: false, httpStatus: 400, upstreamMessage: message, upstreamRequestId: "upstream-request-1" });
    expect(JSON.stringify(result)).not.toContain("fixture-credential");
    expect(JSON.stringify(result)).not.toContain("access_token");
  });

  it.each(["codex", "xai", "github_copilot"] as const)("shows the actual %s managed rejection while removing OAuth credentials", async (adapterKind) => {
    const result = await validateManagedUpstreamModel(
      { providerId: "provider-fixture", adapterKind, authEpoch: 1, managedAccountId: "managed-account-1", managedAccountAuthEpoch: 1, credentialRevision: 4, upstreamModel: "gpt-fixture" },
      {
        resolveAccess: async () => ({
          adapterKind,
          dialect: adapterKind === "github_copilot" ? "openai_chat" : "openai_responses",
          url: "https://chatgpt.com/backend-api/codex/responses",
          headers: new Headers({ authorization: "Bearer managed-secret", version: "0.144.1" }),
          credentialRevision: 4, accountId: "managed-account-1", accountAuthEpoch: 1, defaultRevision: null, renewed: false,
        }),
        fetcher: async () => new Response(JSON.stringify({ detail: "This model is not supported with this account. managed-secret", refresh_token: "private-refresh" }), { status: 400, headers: { "request-id": "request-managed" } }),
      },
    );
    expect(result).toMatchObject({ httpStatus: 400, usable: false, upstreamMessage: "This model is not supported with this account. [REDACTED]", upstreamRequestId: "request-managed" });
    expect(JSON.stringify(result)).not.toContain("managed-secret");
    expect(JSON.stringify(result)).not.toContain("private-refresh");
  });

  it.each(["unreadable", "oversized"])("preserves HTTP classification for an %s diagnostic body", async (kind) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (kind === "unreadable") controller.error(new Error("body transport failure"));
        else { controller.enqueue(new TextEncoder().encode("x".repeat(64 * 1024 + 1))); controller.close(); }
      },
    });
    const result = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => new Response(stream, { status: 400 }) },
    );
    expect(result).toMatchObject({ httpStatus: 400, status: "failed", message: "上游未接受当前模型或协议配置" });
    expect(result.upstreamMessage).toBeUndefined();
  });

  it("cancels a successful response without exposing or consuming model output", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const result = await validateUpstreamModel(
      { protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture-credential" },
      { fetcher: async () => new Response(stream, { status: 200 }) },
    );
    expect(result).toMatchObject({ status: "operational", usable: true });
    expect(result.upstreamMessage).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
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
