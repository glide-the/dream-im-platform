import { describe, expect, it, vi } from "vitest";

import {
  buildDiscoveryDiff,
  fetchProviderModelCatalog,
  parseProviderModelCatalog,
  providerModelEndpointCandidates,
} from "./provider-discovery";

describe("Provider model discovery", () => {
  it("uses cc-switch compatible model endpoint candidates", () => {
    expect(providerModelEndpointCandidates({ protocol: "anthropic", base_url: "https://api.deepseek.com/anthropic", config: {} })).toEqual([
      "https://api.deepseek.com/anthropic/v1/models",
      "https://api.deepseek.com/anthropic/models",
      "https://api.deepseek.com/v1/models",
      "https://api.deepseek.com/models",
    ]);
  });

  it("parses, deduplicates, and sorts OpenAI-compatible catalogs", () => {
    expect(parseProviderModelCatalog({ data: [
      { id: "z-model", owned_by: "vendor" },
      { id: "a-model", owned_by: "vendor" },
      { id: "a-model", owned_by: "vendor-2" },
    ] })).toEqual([
      { id: "a-model", ownedBy: "vendor-2", displayName: "a-model" },
      { id: "z-model", ownedBy: "vendor", displayName: "z-model" },
    ]);
  });

  it("marks existing models and global alias conflicts without overwriting", () => {
    expect(buildDiscoveryDiff(
      "deepseek",
      [{ id: "same", ownedBy: null, displayName: "same" }, { id: "new/model", ownedBy: null, displayName: "new/model" }],
      [{ id: "model_existing", code: "same-alias", upstream_model: "same" }],
      ["same-alias", "new-model", "deepseek-new-model"],
    )).toEqual([
      expect.objectContaining({ id: "same", state: "existing", existingModelId: "model_existing" }),
      expect.objectContaining({ id: "new/model", state: "conflict" }),
    ]);
  });

  it("never calls /models when the Provider uses manual catalog mode", async () => {
    const fetcher = vi.fn(async () => new Response("unexpected"));

    await expect(fetchProviderModelCatalog(
      {
        protocol: "openai",
        base_url: "https://api.openai.com",
        timeout_ms: 5_000,
        config: {
          authMode: "bearer",
          modelCatalogMode: "manual",
          manualModel: "hy3-preview",
        },
      },
      "fixture-secret",
      fetcher as typeof fetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_MODEL_DISCOVERY_DISABLED",
      status: 409,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
