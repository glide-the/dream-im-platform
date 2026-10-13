// [Input] Successful image delivery with incomplete per-image accounting and the original recovery writer.
// [Output] Evidence that delivery remains successful while billing stays explicitly unknown with safe identity.
// [Pos] Provider-free lifecycle contract; no model calls or ledger writes.
// [Sync] 2026-10-10: distinguish image delivery from conservative reservation closure.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mark: vi.fn(), settle: vi.fn() }));
vi.mock("../billing/repository", () => ({ markGatewayRequestSettlementFailed: mocks.mark, settleGatewayRequest: mocks.settle }));
import { finalizeUnknownUsage, finalizeProviderFailure, finalizeKnownUsage } from "./lifecycle";
beforeEach(() => { vi.clearAllMocks(); mocks.mark.mockResolvedValue({ updated: true }); });
it("retains successful delivery and actual call identity without promoting a usage estimate", async () => {
  await finalizeUnknownUsage({ requestId: "req_image", outcome: "succeeded", httpStatus: 200,
    errorCode: "RESPONSES_IMAGE_USAGE_UNKNOWN", errorMessage: "Complete image usage is unavailable",
    startedAt: Date.now(), responseSummary: { responseId: "resp_actual", imageCalls: [{ callId: "ig_actual" }], usageKnown: true } });
  expect(mocks.mark).toHaveBeenCalledOnce();
  expect(mocks.mark).toHaveBeenCalledWith(expect.objectContaining({ gatewayRequestId: "req_image", outcome: "succeeded", httpStatus: 200,
    responseSummary: { responseId: "resp_actual", imageCalls: [{ callId: "ig_actual" }], usageKnown: false,
      settlementResolution: "conservative_estimated_capture_pending" } }));
  expect(mocks.settle).not.toHaveBeenCalled();
});
it("retains the existing failed/cancelled outcome and tolerates recovery storage unavailability", async () => {
  mocks.mark.mockRejectedValue(new Error("storage unavailable"));
  await expect(finalizeUnknownUsage({ requestId: "req_cancelled", outcome: "cancelled", errorCode: "CLIENT_CANCELLED",
    errorMessage: "Cancelled", startedAt: Date.now() })).resolves.toBe(false);
  expect(mocks.mark).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled", responseSummary: {
    usageKnown: false, settlementResolution: "conservative_estimated_capture_pending" } }));
});
it("does not acknowledge a native success after another terminal transition won", async () => {
  mocks.mark.mockResolvedValue({ updated: false });
  await expect(finalizeUnknownUsage({ requestId: "req_race", outcome: "succeeded", errorCode: "RESPONSES_IMAGE_USAGE_UNKNOWN",
    errorMessage: "Unknown complete usage", startedAt: Date.now(), requireTransition: true })).resolves.toBe(false);
});

it("preserves dispatch and call associations on unknown provider failure", async () => {
  await finalizeProviderFailure({ requestId: "req_failed", protocol: "anthropic", error: new Error("unavailable"),
    startedAt: Date.now(), responseSummary: { providerDispatched: true, imageCalls: [{ callId: "actual_call" }] } });
  expect(mocks.mark).toHaveBeenCalledWith(expect.objectContaining({ responseSummary: expect.objectContaining({
    providerDispatched: true, imageCalls: [{ callId: "actual_call" }], usageKnown: false }) }));
});
it("promotes only reliable usage through the known writer while keeping actual call associations", async () => {
  mocks.settle.mockResolvedValue({});
  await finalizeKnownUsage({ requestId: "req_known", outcome: "succeeded", startedAt: Date.now(),
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokenSemantics: "fresh" },
    responseSummary: { usageKnown: false, imageCalls: [{ callId: "actual_call" }] } });
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ responseSummary: {
    usageKnown: true, settlementResolution: "actual_usage", imageCalls: [{ callId: "actual_call" }] } }));
});

// [Sync] 2026-10-11: reported Responses counts remain known while original billing is pending.
it("persists reliable native counts and full-capture facts on settlement failure", async () => {
  mocks.settle.mockRejectedValueOnce(new Error("ledger unavailable"));
  const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, inputTokenSemantics: "total_including_cache" as const };
  const summary = { billingScope: "responses_reported_tokens", requireFullTokenAllowanceCapture: true, imageBillingDetailsKnown: false };
  await expect(finalizeKnownUsage({ requestId: "req_native", outcome: "succeeded", startedAt: Date.now(), usage, responseSummary: summary, requireFullTokenAllowanceCapture: true })).rejects.toMatchObject({ code: "BILLING_SETTLEMENT_UNAVAILABLE", status: 503 });
  expect(mocks.mark).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usage, responseSummary: { ...summary, usageKnown: true, settlementResolution: "actual_usage_pending" } }));
  expect(mocks.settle).toHaveBeenCalledOnce();
});
it("retains stable 503 if a database-wide failure cannot persist pending usage", async () => {
  mocks.settle.mockRejectedValueOnce(new Error("database unavailable")); mocks.mark.mockRejectedValueOnce(new Error("database unavailable"));
  await expect(finalizeKnownUsage({ requestId: "req_native", outcome: "failed", startedAt: Date.now(), usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokenSemantics: "total_including_cache" } })).rejects.toMatchObject({ code: "BILLING_SETTLEMENT_UNAVAILABLE", status: 503 });
  expect(mocks.mark).toHaveBeenCalledOnce(); expect(mocks.settle).toHaveBeenCalledOnce();
});
