import { describe, expect, it } from "vitest";

import {
  decimalUsdToMicrousd,
  flattenModelsDevCatalog,
  matchModelsDevPricing,
  normalizeModelIdForPricing,
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
  });
});
