// [Input] Synthetic public Image requests and Provider responses without external services.
// [Output] Deterministic validation of strict inputs, image magic bytes, base64 results, and Token details.
// [Pos] Provider-free unit coverage for the Images protocol boundary.
// [Sync] 2026-10-09: cover output details, image magic, invalid-result usage, and output-text denial.

import { describe, expect, it } from "vitest";

import {
  ImageProviderResultError,
  parseImageEditRequest,
  parseImageGenerationRequest,
  parseImageProviderResponse,
} from "./image-protocols";

const VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("Images protocol", () => {
  it("accepts a strict generation request", async () => {
    const parsed = await parseImageGenerationRequest(new Request("https://gateway.test/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "image-alias", prompt: "paint a lake", n: 2 }),
    }));
    expect(parsed).toMatchObject({ model: "image-alias", prompt: "paint a lake", n: 2 });
  });

  it("fully decodes multipart image content instead of trusting the filename or magic", async () => {
    const png = Buffer.from(VALID_PNG_BASE64, "base64");
    const form = new FormData();
    form.set("model", "image-alias");
    form.set("prompt", "add a red hat");
    form.set("image", new File([png], "reference.png", { type: "image/png" }));
    const parsed = await parseImageEditRequest(new Request("https://gateway.test/v1/images/edits", {
      method: "POST",
      body: form,
    }));
    expect(parsed.images).toHaveLength(1);
    expect(parsed.images[0]?.mimeType).toBe("image/png");
    const truncated = new FormData();
    truncated.set("model", "image-alias");
    truncated.set("prompt", "add a red hat");
    truncated.set("image", new File([png.subarray(0, 12)], "reference.png", { type: "image/png" }));
    await expect(parseImageEditRequest(new Request("https://gateway.test/v1/images/edits", {
      method: "POST",
      body: truncated,
    }))).rejects.toThrow("matching content");
  });

  it("returns complete reliable usage, strips extensions, and rejects invalid results", async () => {
    const response = {
      created: 1,
      debug_secret: "must-not-pass",
      data: [{ b64_json: VALID_PNG_BASE64, debug_secret: "must-not-pass" }],
      usage: {
        total_tokens: 15,
        input_tokens: 5,
        output_tokens: 10,
        input_tokens_details: { text_tokens: 3, image_tokens: 2 },
        output_tokens_details: { text_tokens: 0, image_tokens: 10 },
      },
    };
    const parsed = await parseImageProviderResponse(response, { providerModel: "gpt-image" });
    expect(parsed.usage).toMatchObject({ inputTextTokens: 3, inputImageTokens: 2, outputTextTokens: 0, outputImageTokens: 10 });
    expect(parsed.imageFormats).toEqual(["image/png"]);
    expect(parsed.body).not.toHaveProperty("debug_secret");
    expect(parsed.body.data[0]).not.toHaveProperty("debug_secret");
    expect((await parseImageProviderResponse({
      ...response,
      usage: {
        total_tokens: 15,
        input_tokens: 5,
        output_tokens: 10,
        input_tokens_details: { text_tokens: 3, image_tokens: 2 },
      },
    }, { providerModel: "gpt-image" })).usage).toMatchObject({
      outputTextTokens: 0,
      outputImageTokens: 10,
    });
    await expect(parseImageProviderResponse({
      ...response,
      data: [{ b64_json: "aGVsbG8=" }],
    }, { providerModel: "gpt-image" })).rejects.toThrow(
      "base64 data that is not a supported image",
    );
    await expect(parseImageProviderResponse({
      ...response,
      data: [{ b64_json: Buffer.from(Buffer.from(VALID_PNG_BASE64, "base64").subarray(0, 12)).toString("base64") }],
    }, { providerModel: "gpt-image" })).rejects.toThrow(
      "base64 data that is not a supported image",
    );
    await expect(parseImageProviderResponse({
      ...response,
      usage: {
        ...response.usage,
        output_tokens: 11,
        total_tokens: 16,
        output_tokens_details: { text_tokens: 1, image_tokens: 10 },
      },
    }, { providerModel: "gpt-image" })).rejects.toThrow("inconsistent Image Token usage");
    await expect(parseImageProviderResponse({
      created: 1,
      data: [{ b64_json: VALID_PNG_BASE64 }],
    }, { providerModel: "gpt-image" })).rejects.toThrow();
    try {
      await parseImageProviderResponse({ ...response, data: [] }, { providerModel: "gpt-image" });
      throw new Error("expected an invalid Image result");
    } catch (error) {
      expect(error).toBeInstanceOf(ImageProviderResultError);
      expect((error as ImageProviderResultError).usage).toMatchObject({
        inputTextTokens: 3,
        inputImageTokens: 2,
        outputImageTokens: 10,
      });
    }
  });
});
