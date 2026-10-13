// [Input] Text catalog prices, local model identities and explicit snapshot candidate selections.
// [Output] Contract coverage for complete candidates, immutable selection and invalid-choice rejection.
// [Pos] Provider-free pricing discovery and apply-selection unit tests.
// [Sync] 2026-09-14: cover manual candidate resolution without client price overrides or truncation.
// [Sync] 2026-10-10: cover Image discovery, platform image-input pricing and text/Image price isolation.
import { describe, expect, it } from "vitest";

import {
  decimalUsdToMicrousd,
  flattenModelsDevCatalog,
  matchModelsDevPricing,
  normalizeModelIdForPricing,
  resolvePricingSyncSelections,
  pricingSyncApplySchema,
  pricingSyncVersionAmounts,
} from "./pricing-sync";

describe("models.dev pricing sync", () => {
  it("normalizes model IDs like cc-switch", () => {
    expect(normalizeModelIdForPricing("openrouter/Claude-3@latest:beta[1m]")).toBe("claude-3-latest");
  });

  it("converts USD per million into integer micro-USD without float multiplication", () => {
    expect(decimalUsdToMicrousd("3")).toBe("3000000");
    expect(decimalUsdToMicrousd("0.003625")).toBe("3625");
    expect(decimalUsdToMicrousd(1e-7)).toBe("0");
  });

  it("flattens text pricing and excludes non-text models", () => {
    const entries = flattenModelsDevCatalog({
      deepseek: {
        name: "DeepSeek",
        models: {
          "deepseek-chat": { name: "DeepSeek Chat", cost: { input: 0.3, output: 1.2, cache_read: 0.06 }, modalities: { output: ["text"] } },
          "deepseek-image": { name: "Image", cost: { input: 1, output: 1 }, modalities: { output: ["image"] } },
        },
      },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ modelId: "deepseek-chat", inputMicrousd: "300000", outputMicrousd: "1200000" });
  });

  it("does not apply ambiguous normalized matches automatically", () => {
    const remote = flattenModelsDevCatalog({
      one: { models: { "vendor/model-a": { cost: { input: 1, output: 2 } } } },
      two: { models: { "other/model-a": { cost: { input: 3, output: 4 } } } },
    });
    const matches = matchModelsDevPricing([
      { id: "m1", code: "alias", upstream_model: "model-a", provider_code: "custom", provider_name: "Custom" },
    ], remote);
    expect(matches[0].match).toBe("ambiguous");
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [])).toThrow("请从当前快照中选择候选");
  });

  const local = { id: "m1", code: "alias", upstream_model: "model-a", provider_code: "custom", provider_name: "Custom" };
  const catalog = flattenModelsDevCatalog({
    one: { name: "One", models: { "model-a": { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 } } } },
    two: { name: "Two", models: { "model-a": { cost: { input: 3, output: 4, cache_read: 0.3, cache_write: 3.75 } } } },
  });

  it("applies only the chosen candidate's complete snapshot prices without mutating the snapshot", () => {
    const matches = matchModelsDevPricing([local], catalog);
    const before = JSON.stringify(matches);
    const selected = resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m1", key: "two/model-a" }]);
    expect(selected[0]).toMatchObject({
      localModelId: "m1", match: "ambiguous", key: "two/model-a", providerId: "two",
      inputMicrousd: "3000000", outputMicrousd: "4000000", cacheReadMicrousd: "300000", cacheWriteMicrousd: "3750000",
    });
    expect(JSON.stringify(matches)).toBe(before);
  });

  it("retains candidate details beyond the former twenty-item preview", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ ...catalog[0], key: `provider-${index}/model-a`, providerId: `provider-${index}` }));
    const matches = matchModelsDevPricing([local], entries);
    expect(matches[0].candidates).toHaveLength(25);
    expect(matches[0].candidateDetails).toHaveLength(25);
    expect(resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m1", key: "provider-24/model-a" }])[0].key).toBe("provider-24/model-a");
  });

  it("rejects unknown, duplicate and cross-model candidate choices", () => {
    const matches = matchModelsDevPricing([local], catalog);
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m1", key: "outside/model-a" }])).toThrow("请从当前快照中选择候选");
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [
      { localModelId: "m1", key: "one/model-a" }, { localModelId: "m1", key: "two/model-a" },
    ])).toThrow("候选选择重复");
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m2", key: "one/model-a" }])).toThrow("不属于已选模型");
  });

  it("requires legacy ambiguous snapshots to be rediscovered", () => {
    const matches = matchModelsDevPricing([local], catalog).map(({ candidateDetails, ...match }) => match);
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m1", key: "one/model-a" }])).toThrow("旧快照需重新同步");
  });

  it("preserves unique matches and rejects unpriced models or candidate overrides", () => {
    const matches = matchModelsDevPricing([local], [catalog[0]]);
    expect(resolvePricingSyncSelections(matches, ["m1"], [])[0]).toEqual(matches[0]);
    expect(() => resolvePricingSyncSelections(matches, ["m1"], [{ localModelId: "m1", key: "one/model-a" }])).toThrow("不接受候选覆盖");
    expect(() => resolvePricingSyncSelections(matches, ["missing"], [])).toThrow("没有可用的目录价格");
    expect(() => resolvePricingSyncSelections(matchModelsDevPricing([local], []), ["m1"], [])).toThrow("没有可用的目录价格");
  });

  const images = {
    openai: { name: "OpenAI", models: {
      "image-model": { cost: { input: 2.5, output: 15, cache_read: 1 }, modalities: { output: ["image"] } },
      "no-price": { modalities: { output: ["image"] } },
      "missing-output": { cost: { input: 2 }, modalities: { output: ["image"] } },
      "text-model": { cost: { input: 1, output: 2 }, modalities: { output: ["text"] } },
      "old-image": { status: "deprecated", cost: { input: 1, output: 2 }, modalities: { output: ["image"] } },
    } },
  };
  it("discovers only priced Image output without inventing an image-input reference", () => {
    const catalog = flattenModelsDevCatalog(images, true);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ kind: "image", inputMicrousd: "2500000", outputMicrousd: "0", imageOutputMicrousd: "15000000", cacheReadMicrousd: "0" });
    expect(flattenModelsDevCatalog(images).map((entry) => entry.modelId)).toEqual(["text-model"]);
    const match = matchModelsDevPricing([{ ...local, upstream_model: "image-model", image_input_price: "4000000", requires_image_input: true }], catalog, true)[0];
    expect(match).toMatchObject({ kind: "image", imageInputMicrousd: "4000000", requiresImageInput: true });
    expect(matchModelsDevPricing([local], [], true)[0]).toMatchObject({ kind: "image", match: "unmatched", imageInputMicrousd: null });
  });
  it("writes catalog image output to the Image column and preserves mixed-model text prices", () => {
    const match = matchModelsDevPricing([{ ...local, upstream_model: "image-model" }], flattenModelsDevCatalog(images, true), true)[0];
    const current = { output_price_microusd_per_million: "7000000", cache_read_price_microusd_per_million: "1000000", cache_write_price_microusd_per_million: "2000000", image_input_price_microusd_per_million: "4000000", image_output_price_microusd_per_million: "12000000" };
    expect(pricingSyncVersionAmounts(match, current)).toEqual({ input: "2500000", output: "7000000", cacheRead: "1000000", cacheWrite: "2000000", imageInput: "4000000", imageOutput: "15000000" });
    expect(pricingSyncVersionAmounts(match, current, 0).imageInput).toBe("0");
    expect(pricingSyncVersionAmounts(match, undefined).imageInput).toBeNull();
    expect(pricingSyncVersionAmounts({ ...catalog[0], localModelId: "m1", localModelCode: "alias", upstreamModel: "model-a", providerCode: "custom", match: "exact" }, current)).toMatchObject({ imageInput: "4000000", imageOutput: "12000000" });
  });
  it("accepts only an explicit safe platform Image input amount, not catalog price overrides", () => {
    expect(pricingSyncApplySchema.safeParse({ modelIds: ["m1"], imageInputPrices: [{ localModelId: "m1", microusd: 0 }] }).success).toBe(true);
    for (const microusd of [-1, 0.5, "0", Number.MAX_SAFE_INTEGER + 1]) {
      expect(pricingSyncApplySchema.safeParse({ modelIds: ["m1"], imageInputPrices: [{ localModelId: "m1", microusd }] }).success).toBe(false);
    }
    expect(pricingSyncApplySchema.safeParse({ modelIds: ["m1"], imageInputPrices: [{ localModelId: "m1", microusd: 1, outputMicrousd: 0 }] }).success).toBe(false);
  });
});
