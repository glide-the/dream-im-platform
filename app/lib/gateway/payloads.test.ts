import { describe, expect, it } from "vitest";
import { redactRequestHeaders, redactResponseHeaders } from "./payloads";

describe("gateway payload redaction", () => {
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
