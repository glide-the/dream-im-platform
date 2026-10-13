// [Input] Provider identity and persisted Image pricing metadata fixtures.
// [Output] Regression proof for API, Codex reference-price, and managed-contract audit labels.
// [Pos] Provider-free unit coverage for the optional Image pricing audit invariant.
// [Sync] 2026-10-09: allow OpenAI API pricing as an explicit Codex reference price without calling it upstream billing.

import { describe, expect, it } from "vitest";

import {
  expectedImagePricingBasis,
  imagePricingBasisMatchesProvider,
  imagePricingBasisFromMetadata,
} from "./image-pricing-contract";

describe("Image pricing contract", () => {
  it("maps supported Image Providers to their normal audit basis", () => {
    expect(expectedImagePricingBasis({ adapterKind: "generic", protocol: "openai" }))
      .toBe("openai_api_usd");
    expect(expectedImagePricingBasis({ adapterKind: "codex", protocol: "openai" }))
      .toBe("codex_reference_api_usd");
    expect(expectedImagePricingBasis({ adapterKind: "generic", protocol: "anthropic" }))
      .toBeUndefined();
  });

  it("accepts the persisted audit values", () => {
    expect(imagePricingBasisFromMetadata({ imagePricingBasis: "openai_api_usd" }))
      .toBe("openai_api_usd");
    expect(imagePricingBasisFromMetadata({ imagePricingBasis: "codex_reference_api_usd" }))
      .toBe("codex_reference_api_usd");
    expect(imagePricingBasisFromMetadata({ imagePricingBasis: "codex_managed_usd_contract" }))
      .toBe("codex_managed_usd_contract");
    expect(imagePricingBasisFromMetadata({ imagePricingBasis: "openai_api_credits" }))
      .toBeUndefined();
    expect(imagePricingBasisFromMetadata(null)).toBeUndefined();
  });

  it("allows either Codex reference pricing or a real managed USD contract", () => {
    expect(imagePricingBasisMatchesProvider({
      adapterKind: "codex", protocol: "openai", basis: "codex_reference_api_usd",
    })).toBe(true);
    expect(imagePricingBasisMatchesProvider({
      adapterKind: "codex", protocol: "openai", basis: "codex_managed_usd_contract",
    })).toBe(true);
    expect(imagePricingBasisMatchesProvider({
      adapterKind: "codex", protocol: "openai", basis: "openai_api_usd",
    })).toBe(false);
  });
});
