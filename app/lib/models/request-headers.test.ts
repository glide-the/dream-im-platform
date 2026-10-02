// [Input] Model header DTOs and synthetic managed Provider headers; no credentials or database.
// [Output] Schema and Codex compatibility precedence regressions, including Provider identity ownership.
// [Pos] Shared model request header policy tests.
// [Sync] 2026-10-02: cover explicit client metadata, defaults, and other managed product boundaries.

import { describe, expect, it } from "vitest";

import { applyManagedProviderRequestHeaders, applyModelRequestHeaders, modelRequestHeadersSchema } from "./request-headers";

describe("model request header configuration", () => {
  it("normalizes valid model-specific headers", () => {
    expect(modelRequestHeadersSchema.parse({
      "User-Agent": "OpenAI/JS 6.39.1",
      "X-Client-Channel": "openclaw",
    })).toEqual({
      "user-agent": "OpenAI/JS 6.39.1",
      "x-client-channel": "openclaw",
    });
  });

  it.each(["Authorization", "x-api-key", "x-client-token", "Host", "Content-Length", "Content-Type", "X-Forwarded-For"])(
    "rejects the gateway-managed header %s",
    (name) => {
      expect(modelRequestHeadersSchema.safeParse({ [name]: "unsafe" }).success).toBe(false);
    },
  );

  it("rejects non-string values and header injection", () => {
    expect(modelRequestHeadersSchema.safeParse({ "x-retry": 3 }).success).toBe(false);
    expect(modelRequestHeadersSchema.safeParse({ "x-client": "safe\r\ninjected: true" }).success).toBe(false);
  });

  it("rejects duplicate header names with different casing", () => {
    expect(modelRequestHeadersSchema.safeParse({
      "User-Agent": "first",
      "user-agent": "second",
    }).success).toBe(false);
  });
});

describe("managed Provider request header precedence", () => {
  const owned = new Headers({
    authorization: "Bearer owned-fixture",
    "chatgpt-account-id": "owned-account",
    originator: "owned-client",
    "content-type": "application/json",
    "user-agent": "default-client/1",
    version: "1",
  });

  it("keeps explicit Codex client metadata without overriding Provider identity", () => {
    const configured = {
      "User-Agent": "compatible-client/2",
      Version: "2",
      "chatgpt-account-id": "other-account",
      originator: "other-client",
      "openai-beta": "responses_websockets=fixture",
    };
    const target = new Headers();
    applyModelRequestHeaders(target, configured);
    applyManagedProviderRequestHeaders(target, owned, configured, "codex");
    expect(Object.fromEntries(target)).toEqual({
      authorization: "Bearer owned-fixture",
      "chatgpt-account-id": "owned-account",
      originator: "owned-client",
      "content-type": "application/json",
      "user-agent": "compatible-client/2",
      version: "2",
      "openai-beta": "responses_websockets=fixture",
    });
  });

  it.each(["codex", "xai", "github_copilot"] as const)("retains %s defaults when no overrides are configured", (product) => {
    const target = new Headers();
    applyManagedProviderRequestHeaders(target, owned, {}, product);
    expect(Object.fromEntries(target)).toEqual(Object.fromEntries(owned));
  });

  it.each(["xai", "github_copilot"] as const)("retains %s product-owned metadata", (product) => {
    const configured = { "user-agent": "other-client/2", version: "2" };
    const target = new Headers(configured);
    applyManagedProviderRequestHeaders(target, owned, configured, product);
    expect(target.get("user-agent")).toBe("default-client/1");
    expect(target.get("version")).toBe("1");
  });
});
