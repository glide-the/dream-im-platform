// [Input] Typed provider timeouts, SDK client config, and unrelated transport failures.
// [Output] Stable error mapping plus shared protocol auth-mode enforcement for SDK clients.
// [Pos] Provider failure-classification regression tests for the Gateway domain.
// [Sync] 2026-09-04: fail closed before creating an OpenAI client with x-api-key mode.

import { describe, expect, it } from "vitest";
import { createOpenAIProviderClient, toProviderGatewayError } from "./provider-clients";
import { ProviderTimeoutError } from "./provider-transport";

describe("provider error classification", () => {
  it("uses the shared resolver for OpenAI SDK client authentication", () => {
    const resolved = {
      provider: {
        protocol: "openai",
        id: "provider-1",
        code: "openai",
        baseUrl: "https://api.openai.com",
        encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
        timeoutMs: 1_000,
        maxRetries: 0,
        config: { authMode: "x-api-key" },
      },
      model: {},
      pricing: {},
      limits: {},
    } as unknown as Parameters<typeof createOpenAIProviderClient>[0];

    let caught: unknown;
    try {
      createOpenAIProviderClient(resolved);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "PROVIDER_AUTH_MODE_INVALID",
      status: 503,
    });
  });

  it.each(["connect", "stream_idle"] as const)(
    "maps %s timeout to retryable HTTP 504",
    (phase) => {
      expect(toProviderGatewayError(new ProviderTimeoutError(phase))).toMatchObject({
        code: "UPSTREAM_TIMEOUT",
        message: "The upstream model provider timed out",
        status: 504,
        type: "upstream_error",
        retryable: true,
      });
    },
  );

  it("keeps a non-timeout transport exception classified as connection failure", () => {
    expect(toProviderGatewayError(new Error("socket reset"))).toMatchObject({
      code: "UPSTREAM_CONNECTION_ERROR",
      status: 502,
      retryable: true,
    });
  });
});
