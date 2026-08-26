// [Input] Mock provider fetch, resolved credentials/config, client cancellation, and fake timeout clock.
// [Output] Regression proof for safe headers plus connection and rolling stream-idle timeout behavior.
// [Pos] Focused provider transport contract tests for the Gateway domain.
// [Sync] 2026-08-27: prove active streams may exceed timeout_ms while idle streams still abort.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderTimeoutError, sendProviderRequest } from "./provider-transport";

vi.mock("../security/credential-encryption", () => ({
  decryptCredential: () => "provider-secret",
}));

afterEach(() => {
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

describe("provider transport Claude Code compatibility", () => {
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
});
