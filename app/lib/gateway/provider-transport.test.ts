// [Input] Mock provider fetch, resolved credentials/config, client cancellation, and fake timeout clock.
// [Output] Regression proof for safe headers, captured upstream errors, credential redaction, and timeout behavior.
// [Pos] Focused provider transport contract tests for the Gateway domain.
// [Sync] 2026-09-04: prove managed transport carries only Provider-owned account fences and no pool default revision.
// [Sync] 2026-10-02: cover JSON/text errors for all managed adapters and renewed-credential rejection capture.
// [Sync] 2026-10-02: preserve Codex model client metadata across renewal while keeping Provider identity owned.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderTimeoutError, sendProviderRequest } from "./provider-transport";

const managedMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  record: vi.fn(),
}));

vi.mock("./managed-provider-credentials", () => ({
  resolveManagedProviderAccess: managedMocks.resolve,
}));
vi.mock("./repository", () => ({
  recordGatewayProviderCredentialUse: managedMocks.record,
}));

vi.mock("../security/credential-encryption", () => ({
  decryptCredential: () => "provider-secret",
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function resolved(timeoutMs = 1_000) {
  return {
    provider: {
      protocol: "anthropic" as const,
      id: "provider-1",
      code: "anthropic",
      baseUrl: "https://api.anthropic.com",
      encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
      timeoutMs,
      maxRetries: 0,
      config: {},
    },
    model: { id: "model-1", code: "alias", upstreamModel: "claude", displayName: "Claude", capabilities: {}, requestHeaders: {} },
    pricingRuleId: "price-1",
    pricing: { inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0 },
    limits: {},
  };
}

function managedResolved(adapterKind: "codex" | "xai" | "github_copilot") {
  return {
    ...resolved(),
    provider: {
      ...resolved().provider,
      protocol: "openai" as const,
      baseUrl: null,
      encryptedCredential: undefined,
      adapterKind,
      activeCredentialKind: "managed_oauth" as const,
      authEpoch: 2,
      managedAccountId: "account-managed",
      managedAccountAuthEpoch: 1,
      credentialRevision: 2,
    },
  };
}

function managedAccess(token = "managed-token", credentialRevision = 2) {
  return {
    url: "https://chatgpt.com/backend-api/codex/responses",
    headers: new Headers({ authorization: `Bearer ${token}` }),
    credentialRevision,
    accountId: "account-managed",
    accountAuthEpoch: 1,
    renewed: credentialRevision > 2,
  };
}

describe("provider transport Claude Code compatibility", () => {
  it.each(["codex", "xai", "github_copilot"] as const)("captures %s JSON rejection details and the upstream request id", async (adapterKind) => {
    managedMocks.resolve.mockResolvedValue(managedAccess());
    const body = { detail: "This model is not supported with this account.", error: { code: "model_not_supported", param: "model" } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      status: 400,
      headers: { "x-request-id": "upstream-rejected" },
    })));
    await expect(sendProviderRequest({
      resolved: managedResolved(adapterKind),
      body: { model: "alias", stream: true },
      requestSignal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 400, responseBody: body, requestId: "upstream-rejected" });
  });

  it.each(["codex", "xai", "github_copilot"] as const)("preserves %s non-JSON rejection text while redacting the used credential", async (adapterKind) => {
    managedMocks.resolve.mockResolvedValue(managedAccess());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Upstream rejected Bearer managed-token for this model.\n", { status: 422 })));
    await expect(sendProviderRequest({
      resolved: managedResolved(adapterKind),
      body: { model: "alias" },
      requestSignal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 422, responseBody: "Upstream rejected [REDACTED] for this model.\n" });
  });

  it("captures the final rejection after one renewal and removes both credential generations", async () => {
    managedMocks.resolve.mockResolvedValueOnce(managedAccess("old-token"))
      .mockResolvedValueOnce(managedAccess("new-token", 3));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("first rejection", { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        detail: "Rejected old-token and new-token",
        access_token: "another-credential",
      }), { status: 401, headers: { "request-id": "last-rejection" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendProviderRequest({
      resolved: managedResolved("codex"),
      body: { model: "alias", stream: false },
      requestSignal: new AbortController().signal,
      allowManagedCredentialRetry: true,
    })).rejects.toMatchObject({
      status: 401,
      responseBody: { detail: "Rejected [REDACTED] and [REDACTED]", access_token: "[REDACTED]" },
      requestId: "last-rejection",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(managedMocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("preserves an empty managed rejection body and cleans up the timeout", async () => {
    vi.useFakeTimers();
    managedMocks.resolve.mockResolvedValue(managedAccess());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(sendProviderRequest({
      resolved: managedResolved("codex"),
      body: { model: "alias" },
      requestSignal: new AbortController().signal,
    })).rejects.toMatchObject({ status: 403, responseBody: "" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps generic upstream error capture with credential redaction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Rejected provider-secret", type: "invalid_request_error" } }), { status: 400 })));
    await expect(sendProviderRequest({
      resolved: resolved(),
      body: { model: "alias" },
      requestSignal: new AbortController().signal,
    })).rejects.toMatchObject({
      status: 400,
      responseBody: { error: { message: "Rejected [REDACTED]", type: "invalid_request_error" } },
    });
  });

  it("pins managed product tokens to the registry endpoint and headers", async () => {
    managedMocks.resolve.mockResolvedValue({
      adapterKind: "xai",
      dialect: "openai_responses",
      url: "https://api.x.ai/v1/responses",
      headers: new Headers({ authorization: "Bearer managed-token", "user-agent": "ink-xai/1" }),
      credentialRevision: 7,
      accountId: "account-xai",
      accountAuthEpoch: 2,
      defaultRevision: null,
      renewed: false,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendProviderRequest({
      resolved: {
        ...resolved(),
        provider: {
          ...resolved().provider,
          protocol: "openai",
          baseUrl: null,
          encryptedCredential: undefined,
          adapterKind: "xai",
          activeCredentialKind: "managed_oauth",
          authEpoch: 3,
          managedAccountId: "account-xai",
          managedAccountAuthEpoch: 2,
          credentialRevision: 7,
        },
        model: {
          ...resolved().model,
          requestHeaders: { "user-agent": "must-not-win" },
        },
      },
      body: { model: "grok", stream: true, input: [] },
      requestSignal: new AbortController().signal,
      gatewayRequestId: "req-1",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(headers.get("authorization")).toBe("Bearer managed-token");
    expect(headers.get("user-agent")).toBe("ink-xai/1");
    expect(managedMocks.record).toHaveBeenCalledWith({
      requestId: "req-1",
      credentialRevision: 7,
      managedAccountId: "account-xai",
      managedAccountAuthEpoch: 2,
      renewalAttempted: false,
    });
    result.abort.cleanup();
  });

  it("preserves Codex model client metadata through a credential renewal", async () => {
    const access = (token: string, revision: number) => ({
      ...managedAccess(token, revision),
      headers: new Headers({
        authorization: `Bearer ${token}`,
        "chatgpt-account-id": "owned-account",
        originator: "owned-client",
        "user-agent": "default-client/1",
        version: "1",
      }),
    });
    managedMocks.resolve.mockResolvedValueOnce(access("old-fixture", 2))
      .mockResolvedValueOnce(access("new-fixture", 3));
    const sentHeaders: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sentHeaders.push(new Headers(init.headers));
      return new Response("{}", { status: sentHeaders.length === 1 ? 401 : 200 });
    }));
    const model = managedResolved("codex");
    const result = await sendProviderRequest({
      resolved: {
        ...model,
        model: { ...model.model, requestHeaders: {
          "user-agent": "compatible-client/2", version: "2",
          "chatgpt-account-id": "other-account", originator: "other-client",
        } },
      },
      body: { model: "alias", stream: false },
      requestSignal: new AbortController().signal,
      allowManagedCredentialRetry: true,
    });
    expect(sentHeaders).toHaveLength(2);
    expect(sentHeaders.map((headers) => headers.get("authorization"))).toEqual(["Bearer old-fixture", "Bearer new-fixture"]);
    for (const headers of sentHeaders) {
      expect(headers.get("user-agent")).toBe("compatible-client/2");
      expect(headers.get("version")).toBe("2");
      expect(headers.get("chatgpt-account-id")).toBe("owned-account");
      expect(headers.get("originator")).toBe("owned-client");
    }
    result.abort.cleanup();
  });

  it("renews and retries a non-streaming managed request only once on 401", async () => {
    managedMocks.resolve
      .mockResolvedValueOnce({
        adapterKind: "github_copilot",
        dialect: "openai_chat",
        url: "https://api.githubcopilot.com/chat/completions",
        headers: new Headers({ authorization: "Bearer old" }),
        credentialRevision: 4,
        accountId: "account-copilot",
        accountAuthEpoch: 3,
        defaultRevision: null,
        renewed: false,
      })
      .mockResolvedValueOnce({
        adapterKind: "github_copilot",
        dialect: "openai_chat",
        url: "https://api.githubcopilot.com/chat/completions",
        headers: new Headers({ authorization: "Bearer new" }),
        credentialRevision: 5,
        accountId: "account-copilot",
        accountAuthEpoch: 3,
        defaultRevision: null,
        renewed: true,
      });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendProviderRequest({
      resolved: {
        ...resolved(),
        provider: {
          ...resolved().provider,
          protocol: "openai",
          baseUrl: null,
          encryptedCredential: undefined,
          adapterKind: "github_copilot",
          activeCredentialKind: "managed_oauth",
          authEpoch: 8,
          managedAccountId: "account-copilot",
          managedAccountAuthEpoch: 3,
          credentialRevision: 4,
        },
      },
      body: { model: "gpt", stream: false, messages: [] },
      requestSignal: new AbortController().signal,
      gatewayRequestId: "req-2",
      allowManagedCredentialRetry: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer new");
    expect(managedMocks.resolve).toHaveBeenLastCalledWith(expect.objectContaining({
      credentialRevision: 4,
      forceRenew: true,
    }));
    expect(managedMocks.record).toHaveBeenLastCalledWith(expect.objectContaining({
      credentialRevision: 5,
      renewalAttempted: true,
    }));
    result.abort.cleanup();
  });

  it("does not replay a managed streaming request after a 401", async () => {
    managedMocks.resolve.mockResolvedValue({
      adapterKind: "codex",
      dialect: "openai_responses",
      url: "https://chatgpt.com/backend-api/codex/responses",
      headers: new Headers({ authorization: "Bearer old" }),
      credentialRevision: 2,
      accountId: "account-codex",
      accountAuthEpoch: 1,
      defaultRevision: null,
      renewed: false,
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendProviderRequest({
      resolved: {
        ...resolved(),
        provider: {
          ...resolved().provider,
          protocol: "openai",
          baseUrl: null,
          encryptedCredential: undefined,
          adapterKind: "codex",
          activeCredentialKind: "managed_oauth",
          authEpoch: 2,
          managedAccountId: "account-codex",
          managedAccountAuthEpoch: 1,
          credentialRevision: 2,
        },
      },
      body: { model: "gpt", stream: true, input: [] },
      requestSignal: new AbortController().signal,
      gatewayRequestId: "req-3",
    })).rejects.toMatchObject({ status: 401, responseBody: "unauthorized" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(managedMocks.resolve).toHaveBeenCalledOnce();
  });

  it("forwards safe Anthropic compatibility headers and beta query without forwarding client auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendProviderRequest({
      resolved: {
        provider: {
          protocol: "anthropic",
          id: "provider-1",
          code: "anthropic",
          baseUrl: "https://api.anthropic.com",
          encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
          timeoutMs: 1_000,
          maxRetries: 0,
          config: {},
        },
        model: { id: "model-1", code: "alias", upstreamModel: "claude", displayName: "Claude", capabilities: {}, requestHeaders: {} },
        pricingRuleId: "price-1",
        pricing: { inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0 },
        limits: {},
      },
      body: { model: "claude", stream: true, messages: [{ role: "system", content: "runtime" }] },
      requestSignal: new AbortController().signal,
      requestUrl: "http://gateway.local/v1/messages?beta=true",
      requestHeaders: new Headers({
        authorization: "Bearer gateway-secret",
        "anthropic-beta": "claude-code-20250219",
        "anthropic-version": "2023-06-01",
        "user-agent": "claude-cli/2.1.220",
        "x-app": "cli",
      }),
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(headers.get("anthropic-beta")).toBe("claude-code-20250219");
    expect(headers.get("user-agent")).toBe("claude-cli/2.1.220");
    expect(headers.get("x-app")).toBe("cli");
    expect(headers.get("x-api-key")).toBe("provider-secret");
    expect(headers.get("authorization")).toBeNull();
    result.abort.cleanup();
  });

  it("allows a healthy stream to exceed timeout_ms while network activity keeps refreshing the idle deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })));

    const result = await sendProviderRequest({
      resolved: resolved(1_000),
      body: { model: "claude", stream: true, messages: [] },
      requestSignal: new AbortController().signal,
    });
    result.abort.refreshStreamIdleTimeout();
    for (let elapsed = 0; elapsed < 5_000; elapsed += 900) {
      await vi.advanceTimersByTimeAsync(900);
      expect(result.abort.signal.aborted).toBe(false);
      result.abort.refreshStreamIdleTimeout();
    }

    await vi.advanceTimersByTimeAsync(1_001);
    expect(result.abort.signal.aborted).toBe(true);
    expect(result.abort.signal.reason).toBeInstanceOf(ProviderTimeoutError);
    expect(result.abort.signal.reason).toMatchObject({ phase: "stream_idle" });
    result.abort.cleanup();
  });

  it("aborts provider connection establishment when no response arrives before timeout_ms", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    })));

    const pending = sendProviderRequest({
      resolved: resolved(1_000),
      body: { model: "claude", stream: true, messages: [] },
      requestSignal: new AbortController().signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "ProviderTimeoutError",
      phase: "connect",
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it("applies model-specific request headers without replacing gateway authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendProviderRequest({
      resolved: {
        provider: {
          protocol: "openai",
          id: "provider-1",
          code: "cloudbase",
          baseUrl: "https://api.openai.com",
          encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
          timeoutMs: 1_000,
          maxRetries: 0,
          config: {},
        },
        model: {
          id: "model-1",
          code: "hy3",
          upstreamModel: "hy3-preview",
          displayName: "HY3",
          capabilities: {},
          requestHeaders: {
            "user-agent": "OpenAI/JS 6.39.1",
            "x-client-channel": "openclaw",
          },
        },
        pricingRuleId: "price-1",
        pricing: { inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0 },
        limits: {},
      },
      body: { model: "hy3-preview", stream: false, messages: [] },
      requestSignal: new AbortController().signal,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("user-agent")).toBe("OpenAI/JS 6.39.1");
    expect(headers.get("x-client-channel")).toBe("openclaw");
    expect(headers.get("authorization")).toBe("Bearer provider-secret");
    result.abort.cleanup();
  });

  it("fails closed when an OpenAI provider is configured for x-api-key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendProviderRequest({
      resolved: {
        ...resolved(),
        provider: {
          ...resolved().provider,
          protocol: "openai",
          baseUrl: "https://api.openai.com",
          config: { authMode: "x-api-key" },
        },
      },
      body: { model: "gpt", stream: false, messages: [] },
      requestSignal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: "PROVIDER_AUTH_MODE_INVALID",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
