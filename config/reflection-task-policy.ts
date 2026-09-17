// [Input] Existing Reflections result truncation and an explicit server report-list capacity.
// [Output] Source-compatible result truncation plus validated operational pagination capacity.
// [Pos] Reflections task policy; request bytes remain governed by DREAM_DATA_MAX_BODY_BYTES.
// [Sync] 2026-09-15: remove invented report field limits and require explicit list capacity.
import { AuthBoundaryError } from "../app/lib/auth/config";

export const reflectionTaskPolicy = Object.freeze({
  resultTitleMaxCharacters: 200,
  resultDescriptionMaxCharacters: 4_000,
  resultEvidenceMaxCharacters: 2_000,
  errorSummaryMaxCharacters: 4_000,
});

export function reflectionReportListCapacity(environment: Record<string, string | undefined> = process.env) {
  const capacity = Number(environment.DREAM_REFLECTION_REPORT_LIST_MAX_ROWS?.trim());
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new AuthBoundaryError("REFLECTION_REPORT_POLICY_INVALID");
  return capacity;
}
