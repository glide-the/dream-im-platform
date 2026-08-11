import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GatewayError } from "./errors";
import {
  deriveGatewayIdempotencyKey,
  estimateJsonTokens,
  parseGatewayJson,
  readIdempotencyKey,
} from "./request-body";

describe("gateway request body", () => {
  it("parses and validates JSON", async () => {
    const result = await parseGatewayJson(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        body: JSON.stringify({ model: "claude" }),
      }),
      z.object({ model: z.string() }),
    );
    expect(result).toEqual({ model: "claude" });
  });

  it("rejects malformed JSON and oversized bodies", async () => {
    await expect(
      parseGatewayJson(
        new Request("http://localhost", { method: "POST", body: "{" }),
        z.unknown(),
      ),
    ).rejects.toBeInstanceOf(GatewayError);

    await expect(
      parseGatewayJson(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-length": String(21 * 1024 * 1024) },
          body: "{}",
        }),
        z.unknown(),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_BODY_TOO_LARGE" });
  });

  it("validates idempotency keys and returns a conservative estimate", () => {
    expect(
      readIdempotencyKey(new Headers({ "idempotency-key": "story:42.run-1" })),
    ).toBe("story:42.run-1");
    expect(() =>
      readIdempotencyKey(new Headers({ "idempotency-key": "has spaces" })),
    ).toThrowError(GatewayError);
    expect(estimateJsonTokens({ text: "hello" })).toBeGreaterThan(0);
  });

  it("derives stable per-provider-request keys from one Dream turn root", () => {
    const headers = new Headers({
      "x-ink-turn-idempotency-key": `dream-turn-${"a".repeat(64)}`,
    });
    const first = deriveGatewayIdempotencyKey(headers, '{"messages":["first"]}');
    expect(first).toMatch(/^turn-[a-f0-9]{24}-request-[a-f0-9]{64}$/);
    expect(deriveGatewayIdempotencyKey(headers, '{"messages":["first"]}')).toBe(first);
    expect(deriveGatewayIdempotencyKey(headers, '{"messages":["tool-result"]}')).not.toBe(first);
  });

  it("rejects ambiguous direct and turn-root idempotency headers", () => {
    const headers = new Headers({
      "idempotency-key": "direct-request",
      "x-ink-turn-idempotency-key": "dream-turn-root",
    });
    expect(() => deriveGatewayIdempotencyKey(headers, "{}")).toThrowError(GatewayError);
  });
});
