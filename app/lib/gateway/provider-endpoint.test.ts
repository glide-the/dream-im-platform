import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "./errors";
import { resolveProviderBaseUrl } from "./provider-endpoint";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...originalEnv };
});

describe("resolveProviderBaseUrl", () => {
  it("allows the official protocol hosts", () => {
    expect(
      resolveProviderBaseUrl({
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com/",
      }),
    ).toBe("https://api.anthropic.com");
    expect(
      resolveProviderBaseUrl({
        protocol: "openai",
        baseUrl: "https://api.openai.com/v1/",
      }),
    ).toBe("https://api.openai.com/v1");
  });

  it("requires an explicit allowlist for a custom HTTPS host", () => {
    expect(() =>
      resolveProviderBaseUrl({
        protocol: "openai",
        baseUrl: "https://models.example.com/v1",
      }),
    ).toThrowError(GatewayError);

    process.env.AI_PROVIDER_HOST_ALLOWLIST = "models.example.com";
    expect(
      resolveProviderBaseUrl({
        protocol: "openai",
        baseUrl: "https://models.example.com/v1",
      }),
    ).toBe("https://models.example.com/v1");
  });

  it("blocks credentials, private IPs, and insecure remote hosts", () => {
    process.env.AI_PROVIDER_HOST_ALLOWLIST = "192.168.1.20,models.example.com";
    for (const baseUrl of [
      "https://user:secret@api.openai.com/v1",
      "https://192.168.1.20/v1",
      "http://models.example.com/v1",
    ]) {
      expect(() =>
        resolveProviderBaseUrl({ protocol: "openai", baseUrl }),
      ).toThrowError(GatewayError);
    }
  });

  it("allows localhost only with the non-production development switch", () => {
    vi.stubEnv("NODE_ENV", "test");
    process.env.AI_PROVIDER_ALLOW_INSECURE_LOCALHOST = "true";
    expect(
      resolveProviderBaseUrl({
        protocol: "anthropic",
        baseUrl: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787");

    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      resolveProviderBaseUrl({
        protocol: "anthropic",
        baseUrl: "http://localhost:8787",
      }),
    ).toThrowError(GatewayError);
  });
});
