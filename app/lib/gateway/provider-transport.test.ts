import { afterEach, describe, expect, it, vi } from "vitest";
import { sendProviderRequest } from "./provider-transport";

vi.mock("../security/credential-encryption", () => ({
  decryptCredential: () => "provider-secret",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

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
