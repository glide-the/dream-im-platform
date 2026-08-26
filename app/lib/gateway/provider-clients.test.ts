// [Input] Typed provider timeouts and unrelated transport failures.
// [Output] Stable public Gateway status/code/message mapping for retryable upstream failures.
// [Pos] Provider failure-classification regression tests for the Gateway domain.
// [Sync] 2026-08-27: distinguish timeout from generic connection failure.

import { describe, expect, it } from "vitest";
import { toProviderGatewayError } from "./provider-clients";
import { ProviderTimeoutError } from "./provider-transport";

describe("provider error classification", () => {
  it.each(["connect", "stream_idle"] as const)(
    "maps %s timeout to retryable HTTP 504",
    (phase) => {
      expect(toProviderGatewayError(new ProviderTimeoutError(phase))).toMatchObject({
        code: "UPSTREAM_TIMEOUT",
        message: "The upstream model provider timed out",
        status: 504,
        type: "upstream_error",
        retryable: true,
      });
    },
  );

  it("keeps a non-timeout transport exception classified as connection failure", () => {
    expect(toProviderGatewayError(new Error("socket reset"))).toMatchObject({
      code: "UPSTREAM_CONNECTION_ERROR",
      status: 502,
      retryable: true,
    });
  });
});
