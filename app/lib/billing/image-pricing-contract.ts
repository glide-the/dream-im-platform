// [Input] Image Provider identity and immutable pricing source metadata.
// [Output] Auditable Image price-source labels for API, Codex reference, or managed USD agreements.
// [Pos] Optional pricing audit invariant used by Admin writes and readiness projections.
// [Sync] 2026-10-09: distinguish configured Codex API-reference prices from actual managed-account billing.

import type { AiProviderProtocol } from "./types";

export const IMAGE_PRICING_BASES = [
  "openai_api_usd",
  "codex_reference_api_usd",
  "codex_managed_usd_contract",
] as const;

export type ImagePricingBasis = (typeof IMAGE_PRICING_BASES)[number];

export function expectedImagePricingBasis(input: {
  adapterKind: string;
  protocol: AiProviderProtocol;
}): ImagePricingBasis | undefined {
  if (input.adapterKind === "codex") return "codex_reference_api_usd";
  if (input.adapterKind === "generic" && input.protocol === "openai") {
    return "openai_api_usd";
  }
  return undefined;
}

export function imagePricingBasisMatchesProvider(input: {
  adapterKind: string;
  protocol: AiProviderProtocol;
  basis: ImagePricingBasis;
}) {
  if (input.adapterKind === "codex") {
    return input.basis === "codex_reference_api_usd"
      || input.basis === "codex_managed_usd_contract";
  }
  return input.adapterKind === "generic"
    && input.protocol === "openai"
    && input.basis === "openai_api_usd";
}

export function imagePricingBasisFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): ImagePricingBasis | undefined {
  const value = metadata?.imagePricingBasis;
  return IMAGE_PRICING_BASES.find((candidate) => candidate === value);
}
