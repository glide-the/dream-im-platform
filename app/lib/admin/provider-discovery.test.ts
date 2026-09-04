// [Input] Provider catalog configurations, bounded upstream responses, and static auth modes.
// [Output] Discovery endpoint, parsing, diff, manual-mode, and fail-closed auth regression coverage.
// [Pos] Unit contract for Provider model discovery.
// [Sync] 2026-09-04: cover safe product compatibility states while preserving generic authentication behavior.

import { describe, expect, it, vi } from "vitest";

import {
  buildDiscoveryDiff,
  fetchProviderModelCatalog,
  managedCatalogHash,
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
      { id: "a-model", ownedBy: "vendor-2", displayName: "a-model", vendor: "vendor-2", upstreamDialect: null, gatewayCompatible: true, capabilities: [] },
      { id: "z-model", ownedBy: "vendor", displayName: "z-model", vendor: "vendor", upstreamDialect: null, gatewayCompatible: true, capabilities: [] },
    ]);
  });

  it("marks existing models and global alias conflicts without overwriting", () => {
    expect(buildDiscoveryDiff(
      "deepseek",
      [
        { id: "same", ownedBy: null, displayName: "same", vendor: null, upstreamDialect: null, gatewayCompatible: true, capabilities: [] },
        { id: "new/model", ownedBy: null, displayName: "new/model", vendor: null, upstreamDialect: null, gatewayCompatible: true, capabilities: [] },
      ],
      [{ id: "model_existing", code: "same-alias", upstream_model: "same" }],
      ["same-alias", "new-model", "deepseek-new-model"],
    )).toEqual([
      expect.objectContaining({ id: "same", state: "existing", existingModelId: "model_existing" }),
      expect.objectContaining({ id: "new/model", state: "conflict" }),
    ]);
  });

  it("keeps an account-visible but Gateway-incompatible model reviewable and unselectable", () => {
    expect(buildDiscoveryDiff(
      "copilot",
      [{
        id: "gpt-copilot",
        ownedBy: "OpenAI",
        displayName: "GPT Copilot",
        vendor: "OpenAI",
        upstreamDialect: "openai_responses",
        gatewayCompatible: false,
        capabilities: [],
      }],
      [],
      [],
    )).toEqual([
      expect.objectContaining({
        id: "gpt-copilot",
        state: "unsupported",
        conflictReason: expect.stringContaining("Gateway"),
      }),
    ]);
  });

  it("keeps a managed catalog hash stable after a PostgreSQL jsonb key-order round trip", () => {
    const generation = {
      adapterKind: "github_copilot" as const,
      authEpoch: 2,
      accountId: "account-1",
      accountAuthEpoch: 3,
      credentialRevision: 4,
      registrationFingerprint: "registration-1",
    };
    const original = [{
      id: "copilot-model",
      ownedBy: "anthropic",
      displayName: "Copilot Model",
      vendor: "anthropic",
      upstreamDialect: "openai_chat" as const,
      gatewayCompatible: true,
      capabilities: ["chat"],
    }];
    const jsonbRoundTripShape = [{
      vendor: "anthropic",
      upstreamDialect: "openai_chat" as const,
      ownedBy: "anthropic",
      id: "copilot-model",
      gatewayCompatible: true,
      displayName: "Copilot Model",
      capabilities: ["chat"],
    }];

    expect(managedCatalogHash(generation, original)).toBe(
      managedCatalogHash(generation, jsonbRoundTripShape),
    );
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

  it("rejects x-api-key authentication for OpenAI-compatible discovery", async () => {
    const fetcher = vi.fn(async () => new Response("unexpected"));

    await expect(fetchProviderModelCatalog(
      {
        protocol: "openai",
        base_url: "https://api.openai.com",
        timeout_ms: 5_000,
        config: { authMode: "x-api-key" },
      },
      "fixture-secret",
      fetcher as typeof fetch,
    )).rejects.toMatchObject({
      code: "PROVIDER_AUTH_MODE_INVALID",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
