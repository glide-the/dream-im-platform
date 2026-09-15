// [Input] Fixed SystemConfig codec name with raw Python JSON and a closed normalized merge patch.
// [Output] Actual isolated Python transport preserving stored numeric categories, Unicode and unknown keys.
// [Pos] Provider-free fixed-codec integration; no database, Runtime import, network or executable selector.
// [Sync] 2026-09-15: pin read/merge behavior and fail closed on invalid stored JSON.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeUserSystemConfig } from "./userSystemConfigCodec";
beforeEach(() => vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"));
afterEach(() => vi.unstubAllEnvs());
it("reads raw stored JSON through the fixed Python codec", async () => {
  expect(await encodeUserSystemConfig({ action: "read", stored_json: '{"integer":9007199254740993,"float":1.0,"negative":-0.0,"text":"正文😀","unknown":{"kept":true}}' }))
    .toEqual({ config_json: '{"integer": 9007199254740993, "float": 1.0, "negative": -0.0, "text": "\\u6b63\\u6587\\ud83d\\ude00", "unknown": {"kept": true}}' });
});
it("merges only the normalized patch while preserving unknown stored keys", async () => {
  const result = await encodeUserSystemConfig({ action: "merge", stored_json: '{"unknown":9007199254740993,"theme":"light"}', patch: { theme: "dark", system_prompt: "正文😀" } });
  expect(result).toEqual({ config_json: '{"unknown": 9007199254740993, "theme": "dark", "system_prompt": "\\u6b63\\u6587\\ud83d\\ude00"}' });
});
it.each(["[]", "null", "{broken", '{"value":NaN}'])("fails closed on invalid stored config %s", async stored_json => {
  await expect(encodeUserSystemConfig({ action: "read", stored_json })).rejects.toMatchObject({ code: "DREAM_CODEC_UNAVAILABLE", status: 503 });
});
