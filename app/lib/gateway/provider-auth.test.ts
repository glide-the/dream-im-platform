import { describe, expect, it } from "vitest";
import { GatewayError } from "./errors";
import { resolveAnthropicAuthMode } from "./provider-auth";

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
