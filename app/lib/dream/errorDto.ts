// [Input] Named domain conflict metadata required by the existing product API.
// [Output] Closed revision/latest and Deck-delete reason DTOs, never arbitrary database error JSON.
// [Pos] Shared safe error-details boundary for Admin and Dream clients.
import { z } from "zod";
export const deckVersionConflictDetailsDto = z.strictObject({ current_draft_revision: z.number().int().nonnegative().safe(), current_version: z.number().int().nonnegative().safe().nullable() });
export const deckDeleteBlockedDetailsDto = z.strictObject({ reason: z.enum(["child_decks", "related_threads", "runtime_history", "referenced_records"]) });
export type DreamDomainErrorDetails = z.infer<typeof deckVersionConflictDetailsDto> | z.infer<typeof deckDeleteBlockedDetailsDto>;
export function projectDomainErrorDetails(code: string, details: unknown) {
  const dto = code === "DECK_VERSION_CONFLICT" ? deckVersionConflictDetailsDto : code === "DECK_DELETE_BLOCKED" ? deckDeleteBlockedDetailsDto : null;
  if (!dto) return undefined;
  const parsed = dto.safeParse(details);
  return parsed.success ? parsed.data : undefined;
}
