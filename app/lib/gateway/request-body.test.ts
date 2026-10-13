// [Input] JSON Gateway requests, chunked bodies, idempotency keys, and strict schemas.
// [Output] Regression evidence for bounded parsing, stable hashing, and validation errors.
// [Pos] Provider-free unit contract for the shared Gateway request-body boundary.
// [Sync] 2026-10-09: reject chunked JSON bodies that exceed the configured byte limit.

import { describe, expect, it, vi } from "vitest";
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

    vi.stubEnv("GATEWAY_MAX_BODY_BYTES", "1024");
    const chunk = new Uint8Array(700).fill(0x20);
    const chunked = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(parseGatewayJson(chunked, z.unknown())).rejects.toMatchObject({
      code: "REQUEST_BODY_TOO_LARGE",
    });
    vi.unstubAllEnvs();
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
