import { describe, expect, it } from "vitest";
import {
  createGatewayApiKey,
  extractGatewayApiKey,
  GatewayKeyConfigurationError,
  getGatewayKeyPepper,
  hashGatewayApiKey,
} from "./api-keys";

const pepper = "test-pepper-that-is-at-least-thirty-two-bytes-long";

describe("gateway API keys", () => {
  it("creates a one-time plaintext and deterministic HMAC lookup hash", () => {
    const created = createGatewayApiKey(pepper);
    expect(created.plaintext).toMatch(/^gw_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toHaveLength(12);
    expect(created.hash).toBe(hashGatewayApiKey(created.plaintext, pepper));
    expect(created.hash).not.toContain(created.plaintext);
  });

  it("accepts Bearer and Anthropic x-api-key headers", () => {
    const key = createGatewayApiKey(pepper).plaintext;
    expect(
      extractGatewayApiKey(new Headers({ authorization: `Bearer ${key}` })),
    ).toBe(key);
    expect(extractGatewayApiKey(new Headers({ "x-api-key": key }))).toBe(key);
    expect(
      extractGatewayApiKey(new Headers({ authorization: "Bearer sk-upstream" })),
    ).toBeNull();
  });

  it("fails closed when no strong server-side pepper is configured", () => {
    const previous = process.env.GATEWAY_API_KEY_PEPPER;
    delete process.env.GATEWAY_API_KEY_PEPPER;
    try {
      expect(() => getGatewayKeyPepper()).toThrow(
        GatewayKeyConfigurationError,
      );
    } finally {
      if (previous === undefined) delete process.env.GATEWAY_API_KEY_PEPPER;
      else process.env.GATEWAY_API_KEY_PEPPER = previous;
    }
  });
});
