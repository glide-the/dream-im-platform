// [Input] Owner-reviewed private target proof plus one legacy canonical Dream user and pinned fingerprint.
// [Output] Closed inspection/adoption DTOs with no caller-selected Better Auth or Admin identity.
// [Pos] Release-only credential compatibility boundary; runtime login never merges users by email.
import { z } from "zod";
import { legacyGoogleAdoptionTargetDto } from "./legacyGoogleAdoptionDto";

const decimalId = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= 9223372036854775807n);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const legacyCredentialInspectionEntryDto = z.strictObject({
  canonical_user_id: decimalId,
  evidence: z.string().trim().min(8).max(500),
});

export const legacyCredentialAdoptionEntryDto = legacyCredentialInspectionEntryDto.extend({
  expected_canonical_sha256: sha256,
});

export const legacyCredentialInspectionConfigDto = z.strictObject({
  version: z.literal(1),
  target: legacyGoogleAdoptionTargetDto,
  entry: legacyCredentialInspectionEntryDto,
});

export const legacyCredentialAdoptionConfigDto = z.strictObject({
  version: z.literal(1),
  target: legacyGoogleAdoptionTargetDto,
  entry: legacyCredentialAdoptionEntryDto,
});

export type LegacyCredentialInspectionEntry = z.infer<typeof legacyCredentialInspectionEntryDto>;
export type LegacyCredentialAdoptionEntry = z.infer<typeof legacyCredentialAdoptionEntryDto>;
