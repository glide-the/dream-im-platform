// [Input] Synthetic protocol images, large text/tool JSON, and isolated environment overrides.
// [Output] Regress encoding-independent image estimates without reducing text/argument checks.
// [Pos] Provider-free Gateway input estimate tests; no user files or services are accessed.
// [Sync] 2026-09-13: cover image Read results and retained model context protection.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateInputTokens } from "./input-token-estimate";
import { estimateJsonTokens } from "./request-body";

const image = (length: number) => ({
  type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(length) },
});
beforeEach(() => { vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", undefined); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("protocol-aware input token estimate", () => {
  it("retains original estimates when the selected Provider requires cross-protocol conversion", () => {
    const anthropic = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "read", content: [image(575_652)] }] }] };
    const openai = { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(575_652)}` } }] }] };
    expect(estimateInputTokens("anthropic", anthropic, "openai")).toBe(estimateJsonTokens(anthropic));
    expect(estimateInputTokens("openai", openai, "anthropic")).toBe(estimateJsonTokens(openai));
  });

  it("counts direct and tool-result images independently of encoded file size", () => {
    const input = (length: number) => ({ messages: [{ role: "user", content: [
      image(length), { type: "tool_result", tool_use_id: "read-1", content: [image(length)] },
    ] }] });
    const large = input(575_652);
    const before = JSON.stringify(large);
    expect(estimateJsonTokens(large)).toBeGreaterThan(380_000);
    expect(estimateInputTokens("anthropic", large)).toBe(estimateInputTokens("anthropic", input(4)));
    expect(estimateInputTokens("anthropic", large)).toBeGreaterThanOrEqual(2 * 4_784);
    expect(JSON.stringify(large)).toBe(before);
  });

  it("recognizes URL/file image sources without retrieving remote data", () => {
    const input = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: "https://example.invalid/image" } },
      { type: "image", source: { type: "file", file_id: "file-test" } },
    ] }] };
    expect(estimateInputTokens("anthropic", input)).toBeGreaterThanOrEqual(2 * 4_784);
  });

  it("handles OpenAI image_url while retaining tools, schemas, and response format", () => {
    const input = (length: number) => ({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(length)}` } }] }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object" } } }],
      response_format: { type: "json_object" },
    });
    expect(estimateInputTokens("openai", input(600_000))).toBe(estimateInputTokens("openai", input(4)));
    expect(estimateInputTokens("openai", input(4))).toBeGreaterThan(4_784);
  });

  it("does not strip image-shaped tool arguments, printed base64, or unsupported binary documents", () => {
    const input = {
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "save", input: image(600_000) }] },
        { role: "user", content: [{ type: "text", text: JSON.stringify(image(600_000)) },
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: "A".repeat(600_000) } },
          { type: "image", source: { type: "invalid", data: "A".repeat(600_000) } }] }],
      tools: [{ input_schema: image(600_000) }],
    };
    expect(estimateInputTokens("anthropic", input)).toBe(estimateJsonTokens(input));
  });

  it("preserves the existing estimate for long UTF-8 text and string tool results", () => {
    const input = { messages: [{ role: "user", content: [
      { type: "text", text: "大文件正文".repeat(200_000) },
      { type: "tool_result", tool_use_id: "1", content: "A".repeat(600_000) },
    ] }], system: "system", tools: [{ input_schema: { type: "object" } }] };
    expect(estimateInputTokens("anthropic", input)).toBe(estimateJsonTokens(input));
    expect(estimateInputTokens("anthropic", input)).toBeGreaterThan(1_000_000);
  });

  it("applies a server override and rejects invalid or overflowing image estimates", () => {
    const input = { messages: [{ role: "user", content: [image(4), image(4)] }] };
    vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", "1024");
    const small = estimateInputTokens("anthropic", input);
    vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", "2048");
    expect(estimateInputTokens("anthropic", input) - small).toBe(2048);
    for (const value of ["", "0", "-1", "1.5", "invalid"]) {
      vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", value);
      expect(() => estimateInputTokens("anthropic", input)).toThrow("must be a positive safe integer");
    }
    vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", String(Number.MAX_SAFE_INTEGER));
    expect(() => estimateInputTokens("anthropic", input)).toThrow("outside the supported range");
  });
});
