// [Input] Synthetic completed Responses images, server bindings and malformed Provider output.
// [Output] Evidence for real identities, fully decoded bytes, operation checks and unknown Image billing.
// [Pos] Provider-free native protocol prerequisite tests; no public execution or real model acceptance.
// [Sync] 2026-10-10: prevent invented usage, duplicate output IDs and unsafe image content from crossing the bridge.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResponsesImageResult, parseResponsesReportedUsage } from "./responses-image-protocol";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const input = { gatewayRequestId: `req_${"a".repeat(32)}`, providerHttpRequestId: "http_actual_id", operation: "generate" as const, maxOutputImages: 1, configuredImageModel: null };
const call = { id: "ig_actual", type: "image_generation_call", status: "completed", result: png, action: "generate", output_format: "png", revised_prompt: "private prompt", usage: { invented: true }, model: "unreported-extension" };
const response = { id: "resp_actual", status: "completed", output: [{ type: "message", id: "msg_text", content: [] }, call], usage: { input_tokens: 30, output_tokens: 20 } };

describe("native Responses image result prerequisite", () => {
  it("delivers fully decoded bytes with real, separate IDs and keeps complete billing unknown", async () => {
    const result = await parseResponsesImageResult(response, input);
    expect(result.images).toEqual([expect.objectContaining({ callId: "ig_actual", outputIndex: 1, b64Json: png, mediaType: "image/png", sha256: createHash("sha256").update(Buffer.from(png, "base64")).digest("hex") })]);
    expect(result.summary).toMatchObject({ gatewayRequestId: input.gatewayRequestId, responseId: "resp_actual", providerHttpRequestId: "http_actual_id", configuredImageModel: null, reportedImageModel: null, usageKnown: false, usageUnknownReason: "responses_image_usage_not_reported", imageCalls: [{ callId: "ig_actual", outputIndex: 1, reportedAction: "generate" }] });
    const safe = JSON.stringify(result.summary);
    for (const secret of [png, "private prompt", "invented", "unreported-extension", "input_tokens", "output_tokens"]) expect(safe).not.toContain(secret);
    expect(result.images[0]).not.toHaveProperty("revised_prompt");
    expect(result).not.toHaveProperty("usage");
  });
  it("records configured Image engine separately without treating it as an upstream report", async () => {
    const result = await parseResponsesImageResult(response, { ...input, configuredImageModel: "namespace/engine-config" });
    expect(result.summary).toMatchObject({ configuredImageModel: "namespace/engine-config", reportedImageModel: null });
  });
  it("accepts absent optional action/format using the bound operation and decoded MIME", async () => {
    const result = await parseResponsesImageResult({ ...response, output: [{ id: "ig_edit", type: "image_generation_call", status: "completed", result: png }] }, { ...input, operation: "edit" });
    expect(result.summary.imageCalls[0]).toMatchObject({ operation: "edit", reportedAction: null, format: "png" });
  });
  it.each([
    { ...response, status: "incomplete" },
    { ...response, id: "" },
    { ...response, output: [] },
    { ...response, output: [{ ...call, status: "failed" }] },
    { ...response, output: [{ ...call, status: "in_progress" }] },
    { ...response, output: [{ ...call, action: "edit" }] },
    { ...response, output: [{ ...call, output_format: "jpeg" }] },
    { ...response, output: [{ ...call, result: null }] },
    { ...response, output: [{ ...call, id: "private\ntext" }] },
    { ...response, output: [call, call] },
  ])("rejects mismatched, duplicate or unfinished output instead of inventing success", async value => {
    await expect(parseResponsesImageResult(value, { ...input, maxOutputImages: 2 })).rejects.toMatchObject({ code: "UPSTREAM_RESPONSES_IMAGE_INVALID" });
  });
  it("rejects output cardinality beyond the server bound before image delivery", async () => {
    await expect(parseResponsesImageResult({ ...response, output: [call, { ...call, id: "ig_second" }] }, input)).rejects.toMatchObject({ code: "UPSTREAM_RESPONSES_IMAGE_INVALID" });
  });
  it.each(["not-base64", Buffer.from("not an image").toString("base64"), Buffer.from(Buffer.from(png, "base64").subarray(0, 12)).toString("base64")])("rejects malformed image bytes", async result => {
    await expect(parseResponsesImageResult({ ...response, output: [{ ...call, result }] }, input)).rejects.toMatchObject({ status: 502 });
  });
  it("requires real Gateway identity and server policy instead of accepting caller extensions", async () => {
    await expect(parseResponsesImageResult(response, { ...input, gatewayRequestId: "broker_uuid" })).rejects.toMatchObject({ code: "UPSTREAM_RESPONSES_IMAGE_INVALID" });
    await expect(parseResponsesImageResult(response, { ...input, maxOutputImages: 0 })).rejects.toMatchObject({ code: "UPSTREAM_RESPONSES_IMAGE_INVALID" });
    await expect(parseResponsesImageResult(response, { ...input, route: "image_gen" } as typeof input)).rejects.toMatchObject({ code: "UPSTREAM_RESPONSES_IMAGE_INVALID" });
  });
});

// [Sync] 2026-10-11: strict official ResponseUsage and immutable image-receipt compatibility.
const officialUsage = { input_tokens: 100, output_tokens: 20, total_tokens: 120,
  input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } };
describe("official Responses reported usage", () => {
  it("projects inclusive counts, strips private extensions and keeps receipt billing separate", () => {
    const parsed = parseResponsesReportedUsage({ id: "resp_actual", model: "ai_model", usage: { ...officialUsage, private: "secret", input_tokens_details: { ...officialUsage.input_tokens_details, private: "secret" } } });
    expect(parsed).toMatchObject({ status: "reported", usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 10, inputTokenSemantics: "total_including_cache", upstreamRequestId: "resp_actual" } });
    expect(parsed.responsesUsage).toEqual(officialUsage);
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parsed.usage!.inputTokens + parsed.usage!.outputTokens).toBe(120);
  });
  it("accepts official legacy cache-write omission and legitimate all-zero counts", () => {
    expect(parseResponsesReportedUsage({ usage: { ...officialUsage, input_tokens_details: { cached_tokens: 40 } } }).usage?.cacheWriteTokens).toBe(0);
    expect(parseResponsesReportedUsage({ usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } })).toMatchObject({ status: "reported", usage: { inputTokens: 0, outputTokens: 0 } });
  });
  it.each([undefined, null])("distinguishes missing usage from invalid reports", usage => {
    expect(parseResponsesReportedUsage({ usage })).toMatchObject({ status: "missing", usage: null });
  });
  it.each([
    {}, { ...officialUsage, input_tokens: "100" }, { ...officialUsage, input_tokens: -1 },
    { ...officialUsage, output_tokens: 20.5 }, { ...officialUsage, total_tokens: 160 },
    { ...officialUsage, input_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { ...officialUsage, input_tokens: Number.MAX_SAFE_INTEGER, total_tokens: Number.MAX_SAFE_INTEGER },
    { ...officialUsage, input_tokens_details: { cached_tokens: 95, cache_write_tokens: 10 } },
    { ...officialUsage, input_tokens_details: { cached_tokens: "40" } },
    { ...officialUsage, output_tokens_details: { reasoning_tokens: 21 } },
    { ...officialUsage, output_tokens_details: undefined },
  ])("rejects incomplete, coerced, inconsistent or unsafe reports", usage => {
    expect(parseResponsesReportedUsage({ usage })).toEqual({ status: "invalid", usage: null, responsesUsage: null });
  });
});
