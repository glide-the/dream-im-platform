// [Sync] 2026-10-10: cover explicit generic Responses selection, original defaults and fail-closed ownership.
// [Input] Static Provider endpoints plus explicit host/local-topology capabilities.
// [Output] Regression proof for canonicalization, HTTPS/SSRF fencing, and label-independent localhost opt-in.
// [Pos] Unit contract for the shared static Provider endpoint resolver.
// [Sync] 2026-09-04: remove deployment-name branching from the localhost capability test.

import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "./errors";
import { resolveProviderBaseUrl, resolveProviderApi, resolveProviderInferenceEndpoint } from "./provider-endpoint";

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

  it("allows localhost only with the explicit topology capability", () => {
    process.env.AI_PROVIDER_ALLOW_INSECURE_LOCALHOST = "true";
    expect(
      resolveProviderBaseUrl({
        protocol: "anthropic",
        baseUrl: "http://localhost:8787",
      }),
    ).toBe("http://localhost:8787");

    delete process.env.AI_PROVIDER_ALLOW_INSECURE_LOCALHOST;
    expect(() =>
      resolveProviderBaseUrl({
        protocol: "anthropic",
        baseUrl: "http://localhost:8787",
      }),
    ).toThrowError(GatewayError);
  });
});


describe("explicit inference API", () => {
  it("keeps legacy Chat and owned product APIs and rejects overrides", () => {
    expect(resolveProviderApi({ protocol: "openai" })).toBe("chat");
    expect(resolveProviderApi({ protocol: "anthropic" })).toBe("messages");
    expect(resolveProviderApi({ protocol: "openai", adapterKind: "codex" })).toBe("responses");
    expect(resolveProviderApi({ protocol: "openai", adapterKind: "github_copilot" })).toBe("chat");
    for (const openaiApi of [null, "", true, ["responses"], "auto"]) {
      expect(() => resolveProviderApi({ protocol: "openai", config: { openaiApi } })).toThrowError(GatewayError);
    }
    expect(() => resolveProviderApi({ protocol: "anthropic", config: { openaiApi: "responses" } })).toThrowError(GatewayError);
    expect(() => resolveProviderApi({ protocol: "openai", adapterKind: "codex", config: { openaiApi: "responses" } })).toThrowError(GatewayError);
  });
  it("uses the configured endpoint once and refuses a contradictory full API path", () => {
    for (const baseUrl of ["https://api.openai.com", "https://api.openai.com/v1", "https://api.openai.com/v1/responses"]) {
      expect(resolveProviderInferenceEndpoint({ protocol: "openai", baseUrl, config: { openaiApi: "responses" } })).toBe("https://api.openai.com/v1/responses");
    }
    expect(resolveProviderInferenceEndpoint({ protocol: "openai", baseUrl: "https://api.openai.com/v1/chat/completions" })).toBe("https://api.openai.com/v1/chat/completions");
    expect(() => resolveProviderInferenceEndpoint({ protocol: "openai", baseUrl: "https://api.openai.com/v1/chat/completions", config: { openaiApi: "responses" } })).toThrowError(expect.objectContaining({ code: "PROVIDER_ENDPOINT_API_MISMATCH" }));
    expect(() => resolveProviderInferenceEndpoint({ protocol: "openai", baseUrl: "https://api.openai.com/v1/responses" })).toThrowError(GatewayError);
  });
});
