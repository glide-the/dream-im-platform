// [Input] Synthetic authentication headers and structured/text Provider rejection bodies.
// [Output] Regression proof that captured payload evidence preserves reasons while removing credentials.
// [Pos] Gateway payload redaction contracts without database writes.
// [Sync] 2026-10-02: cover nested error credentials, token echoes, and unchanged diagnostic fields.

import { describe, expect, it } from "vitest";
import { redactProviderErrorBody, redactRequestHeaders, redactResponseHeaders } from "./payloads";

describe("gateway payload redaction", () => {
  it("preserves nested diagnostic fields while removing credential fields and echoed secrets", () => {
    const body = {
      detail: "Unsupported model for bearer-secret",
      error: { code: "model_not_supported", param: "model", input_tokens: 0 },
      diagnostics: [{ access_token: "hidden-access", refreshToken: "hidden-refresh", headers: { Authorization: "hidden-auth", "x-api-key": "hidden-key", cookie: "hidden-cookie" } }],
      ["key-secret"]: "key-secret",
    };
    const result = redactProviderErrorBody(body, [new Headers({ authorization: "Bearer bearer-secret", "x-api-key": "key-secret" })]);
    expect(result).toEqual({
      detail: "Unsupported model for [REDACTED]",
      error: { code: "model_not_supported", param: "model", input_tokens: 0 },
      diagnostics: [{ access_token: "[REDACTED]", refreshToken: "[REDACTED]", headers: { Authorization: "[REDACTED]", "x-api-key": "[REDACTED]", cookie: "[REDACTED]" } }],
      "[REDACTED]": "[REDACTED]",
    });
    expect(body.detail).toBe("Unsupported model for bearer-secret");
  });

  it("preserves plain text, arrays and null without credentials", () => {
    expect(redactProviderErrorBody("Upstream model unavailable.\n", [])).toBe("Upstream model unavailable.\n");
    expect(redactProviderErrorBody([null, { detail: "unsupported" }, 400], [])).toEqual([null, { detail: "unsupported" }, 400]);
  });

  it("redacts authentication fields before persistence and ignores unknown headers", () => {
    const result = redactRequestHeaders(new Headers({
      authorization: "Bearer gateway-secret",
      "x-api-key": "provider-secret",
      cookie: "session=secret",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-unapproved": "must-not-persist",
    }));
    expect(result).toEqual({
      authorization: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      cookie: "[REDACTED]",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.stringify(result)).not.toContain("gateway-secret");
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("never persists response cookies", () => {
    expect(redactResponseHeaders(new Headers({ "set-cookie": "secret", "content-type": "text/event-stream", server: "private" }))).toEqual({ "set-cookie": "[REDACTED]", "content-type": "text/event-stream" });
  });
});
