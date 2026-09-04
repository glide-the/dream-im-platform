// [Input] Current and historical Provider configs containing nested secret-like keys.
// [Output] Coverage for immutable recursive sanitization without false positives on Token parameter names.
// [Pos] Unit contract for the shared Admin Provider config secret firewall.
// [Sync] 2026-09-04: redact historical config while preserving safe UI configuration.

import { describe, expect, it } from "vitest";

import {
  findForbiddenProviderConfigKey,
  sanitizeProviderConfig,
} from "./provider-config-safety";

describe("Provider config safety", () => {
  it("finds and removes nested secret-like fields without mutating input", () => {
    const config = {
      authMode: "bearer",
      nested: [{ client_secret: "never-return", safe: true }],
    };

    expect(findForbiddenProviderConfigKey(config)).toEqual([
      "nested",
      0,
      "client_secret",
    ]);
    expect(sanitizeProviderConfig(config)).toEqual({
      authMode: "bearer",
      nested: [{ safe: true }],
    });
    expect(config.nested[0].client_secret).toBe("never-return");
  });

  it("preserves explicit non-secret Token configuration", () => {
    const config = {
      outputTokenParam: "max_completion_tokens",
      maxOutputTokens: 1,
      modelCatalogMode: "manual",
    };

    expect(findForbiddenProviderConfigKey(config)).toBeNull();
    expect(sanitizeProviderConfig(config)).toEqual(config);
  });
});
