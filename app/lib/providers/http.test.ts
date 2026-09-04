// [Input] Provider HTTP responses with control-plane and model-catalog byte budgets.
// [Output] Regression proof that both parsing lanes remain bounded without exposing upstream bodies.
// [Pos] Unit security contract for shared Provider control-plane response parsing.
// [Sync] 2026-09-04: cover actual streamed-byte limits independently of Content-Length.

import { describe, expect, it } from "vitest";

import {
  MAX_MODEL_CATALOG_RESPONSE_BYTES,
  readJsonRecord,
} from "./http";

describe("Provider HTTP response parsing", () => {
  it("parses a bounded JSON object", async () => {
    await expect(readJsonRecord(new Response('{"ok":true}'))).resolves.toEqual({ ok: true });
  });

  it("rejects a declared oversized response without exposing its body", async () => {
    const secret = "upstream-secret-body";
    const result = readJsonRecord(new Response(secret, {
      status: 502,
      headers: { "content-length": String(64 * 1024 + 1) },
    }));
    await expect(result).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      httpStatus: 502,
    });
    await expect(result).rejects.not.toThrow(secret);
  });

  it("rejects a chunked oversized response by counted bytes", async () => {
    const secret = "chunked-secret-marker";
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(40 * 1024)));
        controller.enqueue(encoder.encode(`${"y".repeat(25 * 1024)}${secret}`));
        controller.close();
      },
    });
    const result = readJsonRecord(new Response(stream, { status: 502 }));
    await expect(result).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_TOO_LARGE",
      httpStatus: 502,
    });
    await expect(result).rejects.not.toThrow(secret);
  });

  it("allows a larger bounded model catalog without relaxing the OAuth response default", async () => {
    const payload = JSON.stringify({
      data: [{ id: "catalog-model", description: "x".repeat(70 * 1024) }],
    });

    await expect(readJsonRecord(new Response(payload))).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_TOO_LARGE",
    });
    await expect(readJsonRecord(new Response(payload), {
      maxBytes: MAX_MODEL_CATALOG_RESPONSE_BYTES,
    })).resolves.toMatchObject({
      data: [{ id: "catalog-model" }],
    });
  });

  it("still rejects a model catalog beyond its dedicated bound", async () => {
    await expect(readJsonRecord(new Response("{}", {
      headers: {
        "content-length": String(MAX_MODEL_CATALOG_RESPONSE_BYTES + 1),
      },
    }), {
      maxBytes: MAX_MODEL_CATALOG_RESPONSE_BYTES,
    })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });
});
