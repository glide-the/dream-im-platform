// [Input] Owner-reviewed private target proof plus legacy canonical/Google source identifiers and fingerprints.
// [Output] Closed inspection/adoption DTOs with no caller-selected Better Auth subject or Admin membership.
// [Pos] Release-only legacy Google adoption boundary; runtime login never performs email-based implicit merging.
import { z } from "zod";

const decimalId = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= 9223372036854775807n);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

export const legacyGoogleAdoptionTargetDto = z.strictObject({
  database: z.string().regex(/^[A-Za-z0-9_-]{1,63}$/),
  port: z.number().int().min(1).max(65535),
  data_directory: z.string().min(2).max(4096).refine(value => value.startsWith("/")),
});

export const legacyGoogleInspectionEntryDto = z.strictObject({
  canonical_user_id: decimalId,
  legacy_google_account_id: decimalId,
  evidence: z.string().trim().min(8).max(500),
});

export const legacyGoogleAdoptionEntryDto = legacyGoogleInspectionEntryDto.extend({
  expected_canonical_sha256: sha256,
  expected_google_sha256: sha256,
});

export const legacyGoogleInspectionConfigDto = z.strictObject({
  version: z.literal(1),
  target: legacyGoogleAdoptionTargetDto,
  entry: legacyGoogleInspectionEntryDto,
});

export const legacyGoogleAdoptionConfigDto = z.strictObject({
  version: z.literal(1),
  target: legacyGoogleAdoptionTargetDto,
  entry: legacyGoogleAdoptionEntryDto,
});

export type LegacyGoogleInspectionEntry = z.infer<typeof legacyGoogleInspectionEntryDto>;
export type LegacyGoogleAdoptionEntry = z.infer<typeof legacyGoogleAdoptionEntryDto>;
export type LegacyGoogleAdoptionTarget = z.infer<typeof legacyGoogleAdoptionTargetDto>;
