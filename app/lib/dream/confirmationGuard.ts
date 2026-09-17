// [Input] Current stored control envelope/claim and a potentially older queued user-turn snapshot.
// [Output] True only for a valid pre-persisted confirmation that must not be written again.
// [Pos] Port of the production confirmation persistence guard; existing DB facts classify authority.
// [Sync] 2026-09-15: preserve newer durable leases, exact raw parts/hash and Python claim equality.
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ConfirmationGuardRepository } from "./confirmationGuardRepository";
import { analyzeConfirmationEnvelope, compareConfirmationClaims, canonicalBusinessJson } from "./deckContentCanonical";

export type ConfirmationGuardInput = { thread_id: string; message_id: string; parts_json: string; metadata_json: string | null };
const confirmationKind = "story-workspace-dream-confirmation";
const conflict = () => { throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409); };
function metadata(raw: string | null) {
  if (raw === null) return null;
  try { const value: unknown = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
  catch { return null; }
}
const validLease = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export async function guardPersistedDreamConfirmation(tx: DataTransaction, canonicalUserId: string, input: ConfirmationGuardInput): Promise<boolean> {
  decimalIdDto.parse(canonicalUserId);
  const repository = new ConfirmationGuardRepository(tx);
  let row: Awaited<ReturnType<ConfirmationGuardRepository["message"]>>;
  try { row = await repository.message(input.message_id); }
  catch { throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_UNAVAILABLE"); }
  const stored = metadata(row?.metadata_json ?? null), incoming = metadata(input.metadata_json);
  const reserved = input.message_id.startsWith("dream_confirm_");
  if (!reserved && stored?.kind !== confirmationKind && incoming?.kind !== confirmationKind) return false;
  if (!row || !stored || !incoming || row.role !== "user" || row.id !== input.message_id || row.thread_id !== input.thread_id || row.user_id !== canonicalUserId || stored.kind !== confirmationKind || stored.actor !== canonicalUserId || stored.thread_id !== row.thread_id || !row.parts_json || !row.metadata_json || !input.metadata_json) return conflict();
  const envelope = await analyzeConfirmationEnvelope(row.parts_json, canonicalUserId);
  if (envelope.status !== "valid" || envelope.message_id !== row.id || envelope.story_workspace_run_id !== stored.story_workspace_run_id || envelope.thread_id !== row.thread_id || envelope.idempotency_key !== stored.idempotency_key || envelope.command_fingerprint !== stored.command_fingerprint || typeof stored.request_id !== "string" || !stored.request_id) return conflict();
  let ownsRun: boolean;
  try { ownsRun = await repository.ownsRun(canonicalUserId, input.thread_id, envelope.story_workspace_run_id); }
  catch { throw new AuthBoundaryError("DECK_RUNTIME_CONFIG_UNAVAILABLE"); }
  const now = Date.now() / 1_000, currentLease = stored.dispatch_claim_lease_until, requestedLease = incoming.dispatch_claim_lease_until;
  if (!ownsRun || stored.dispatch_status !== "dispatching" || incoming.dispatch_status !== "dispatching" || !validLease(now) || !validLease(currentLease) || !validLease(requestedLease) || currentLease <= now || requestedLease > currentLease) return conflict();
  if (!(await compareConfirmationClaims(row.metadata_json, input.metadata_json)).equal) return conflict();
  const requestParts = await canonicalBusinessJson(input.parts_json);
  if (envelope.parts_canonical_json !== requestParts.canonical_json) return conflict();
  return true;
}
