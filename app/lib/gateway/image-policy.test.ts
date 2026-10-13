// [Sync] 2026-10-10: verify legacy text, Images-only and explicitly mixed publication boundaries.
// [Input] Explicit Provider Image markers and deterministic prompt/image cardinalities.
// [Output] Provider admission and conservative, overflow-safe Image Token reservations.
// [Pos] Provider-free contract tests for the Image Gateway policy boundary.
// [Sync] 2026-10-09: cover OpenAI/Codex admission and generation/edit reservation math.

import { describe, expect, it } from "vitest";
import { imageTokenReservation, modelSupportsConversation, providerSupportsImages } from "./image-policy";

const provider = (overrides: Record<string, unknown>) => ({
  id: "provider",
  code: "provider",
  protocol: "openai" as const,
  baseUrl: "https://example.invalid",
  adapterKind: "generic" as const,
  timeoutMs: 10_000,
  maxRetries: 0,
  config: {},
  ...overrides,
});

describe("Image Gateway policy", () => {
  it("keeps legacy text models callable while requiring explicit chat publication for Images-capable models", () => {
    expect(modelSupportsConversation(null)).toBe(true);
    expect(modelSupportsConversation({ tools: true })).toBe(true);
    expect(modelSupportsConversation({ chat: false })).toBe(false);
    expect(modelSupportsConversation({ image_generation: true, image_edit: true })).toBe(false);
    expect(modelSupportsConversation({ image_edit: true })).toBe(false);
    expect(modelSupportsConversation({ chat: true, image_generation: true })).toBe(true);
  });
  it("admits Codex and explicitly marked OpenAI but not arbitrary compatible providers", () => {
    expect(providerSupportsImages(provider({ adapterKind: "codex" }))).toBe(true);
    expect(providerSupportsImages(provider({ config: { imageApi: { kind: "openai" } } }))).toBe(true);
    expect(providerSupportsImages(provider({ config: {} }))).toBe(false);
    expect(providerSupportsImages(provider({ adapterKind: "xai" }))).toBe(false);
  });

  it("reserves UTF-8 prompt bytes plus input and n-scaled output budgets", () => {
    expect(imageTokenReservation({
      prompt: "图",
      inputImageCount: 2,
      outputImageCount: 3,
      inputTokenReservePerImage: 100,
      outputTokenReservePerImage: 1_000,
    })).toBe(3 + 200 + 3_000);
  });

  it("fails closed when a required per-image budget is absent", () => {
    expect(() => imageTokenReservation({
      prompt: "edit",
      inputImageCount: 1,
      outputImageCount: 1,
      outputTokenReservePerImage: 1,
    })).toThrow("input Token reservation");
  });
});
