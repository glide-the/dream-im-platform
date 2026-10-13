// [Sync] 2026-10-10: Images-only publication requires explicit chat capability before conversation admission.
// [Input] Resolved Provider/model configuration and normalized Image request cardinality.
// [Output] Explicit OpenAI/Codex admission and conservative Token allowance reservation.
// [Pos] Image Gateway policy boundary; actual usage and pricing remain Provider/Billing-owned.
// [Sync] 2026-10-09: require explicit OpenAI Image marking and per-image reservation budgets.

import { z } from "zod";
import type { ResolvedBillableModel } from "../models/resolver";

const openAIImageConfigSchema = z.object({
  imageApi: z.object({ kind: z.literal("openai") }).strict(),
}).passthrough();

export function modelSupportsConversation(capabilities: Record<string, boolean> | null | undefined) {
  const values = capabilities ?? {};
  return values.chat !== false && (!(values.image_generation || values.image_edit) || values.chat === true);
}

export function providerSupportsImages(
  provider: ResolvedBillableModel["provider"],
) {
  if (provider.adapterKind === "codex") return true;
  return provider.adapterKind === "generic"
    && provider.protocol === "openai"
    && openAIImageConfigSchema.safeParse(provider.config).success;
}

export function imagePromptTokenReservation(prompt: string) {
  const bytes = Buffer.byteLength(prompt, "utf8");
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new RangeError("Image prompt must contain UTF-8 bytes");
  }
  // A BPE token represents at least one source byte. Reserving one Token per
  // UTF-8 byte is deliberately conservative without pretending to be usage.
  return bytes;
}

export function imageTokenReservation(input: {
  prompt: string;
  inputImageCount: number;
  outputImageCount: number;
  inputTokenReservePerImage?: number;
  outputTokenReservePerImage?: number;
}) {
  const counts = [input.inputImageCount, input.outputImageCount];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError("Image counts must be non-negative safe integers");
  }
  if (
    input.inputImageCount > 0 &&
    (!Number.isSafeInteger(input.inputTokenReservePerImage)
      || (input.inputTokenReservePerImage ?? 0) <= 0)
  ) {
    throw new RangeError("Image input Token reservation is not configured");
  }
  if (
    input.outputImageCount > 0 &&
    (!Number.isSafeInteger(input.outputTokenReservePerImage)
      || (input.outputTokenReservePerImage ?? 0) <= 0)
  ) {
    throw new RangeError("Image output Token reservation is not configured");
  }
  const reserved = imagePromptTokenReservation(input.prompt)
    + input.inputImageCount * (input.inputTokenReservePerImage ?? 0)
    + input.outputImageCount * (input.outputTokenReservePerImage ?? 0);
  if (!Number.isSafeInteger(reserved)) {
    throw new RangeError("Image Token reservation exceeds the safe integer range");
  }
  return reserved;
}
