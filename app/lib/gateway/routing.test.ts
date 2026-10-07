// [Input] Explicit Provider rejection and ambiguous execution failures.
// [Output] Proof that failover never repeats unknown execution or usage-bearing failures.
// [Pos] Pre-response retry safety policy tests.
import { describe, expect, it } from "vitest";
import { ProviderHttpError, ProviderTimeoutError } from "./provider-transport";
import { canFallbackProvider } from "./routing";
describe("routing retry boundary", () => {
  it("permits only explicit capacity/service rejection", () => {
    for (const status of [429, 502, 503, 504]) expect(canFallbackProvider(new ProviderHttpError(status, { error: "rejected" }))).toBe(true);
    for (const status of [400, 401, 403, 408, 500]) expect(canFallbackProvider(new ProviderHttpError(status, {}))).toBe(false);
  });
  it("never retries timeout, interrupted transport or any usage evidence", () => {
    expect(canFallbackProvider(new ProviderTimeoutError("connect"))).toBe(false);
    expect(canFallbackProvider(new TypeError("fetch failed"))).toBe(false);
    expect(canFallbackProvider(new ProviderHttpError(503, { usage: { input_tokens: 10 } }))).toBe(false);
    expect(canFallbackProvider(new ProviderHttpError(503, { usage: {} }))).toBe(false);
    expect(canFallbackProvider(new ProviderHttpError(503, { response: {} }))).toBe(false);
  });
});
