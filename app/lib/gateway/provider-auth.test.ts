// [Input] Provider protocols and persisted authentication-mode configuration.
// [Output] Coverage for protocol-specific defaults and fail-closed invalid modes.
// [Pos] Unit contract for the shared Provider authentication-mode resolver.
// [Sync] 2026-09-04: cover OpenAI bearer-only and Anthropic dual-mode resolution.

import { describe, expect, it } from "vitest";
import { GatewayError } from "./errors";
import {
  resolveAnthropicAuthMode,
  resolveProviderAuthMode,
} from "./provider-auth";

describe("resolveAnthropicAuthMode", () => {
  it("defaults to native x-api-key authentication", () => {
    expect(resolveAnthropicAuthMode({})).toBe("x-api-key");
    expect(resolveAnthropicAuthMode({ authMode: "x-api-key" })).toBe(
      "x-api-key",
    );
  });

  it("supports bearer-only Claude relays", () => {
    expect(resolveAnthropicAuthMode({ authMode: "bearer" })).toBe("bearer");
  });

  it("fails closed for unknown authentication modes", () => {
    expect(() => resolveAnthropicAuthMode({ authMode: "query" })).toThrow(
      GatewayError,
    );
  });
});

describe("resolveProviderAuthMode", () => {
  it("resolves OpenAI-compatible providers as bearer-only", () => {
    expect(resolveProviderAuthMode({ protocol: "openai", config: {} })).toBe(
      "bearer",
    );
    expect(
      resolveProviderAuthMode({
        protocol: "openai",
        config: { authMode: "bearer" },
      }),
    ).toBe("bearer");
  });

  it("rejects unsupported OpenAI and Anthropic authentication modes", () => {
    expect(() =>
      resolveProviderAuthMode({
        protocol: "openai",
        config: { authMode: "x-api-key" },
      }),
    ).toThrow(GatewayError);
    expect(() =>
      resolveProviderAuthMode({
        protocol: "anthropic",
        config: { authMode: "query" },
      }),
    ).toThrow(GatewayError);
  });
});
