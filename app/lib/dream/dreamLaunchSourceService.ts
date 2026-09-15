// [Input] OAuth write principal, closed launch request and one existing Admin UOW.
// [Output] Atomic hidden source or bounded read of an existing frozen launch Run.
// [Pos] Registered launch persistence domain; source identity/content are server-derived.
// [Sync] 2026-09-16: expose actor-scoped idempotent replay identity before current Runtime planning.
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import { identitySchemaRequirement } from "./schemaRequirements";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import type { ChatThreadActor } from "./chatThreadService";
import { ReceiptRepository } from "./receipts";
import { dreamLaunchReplayLookupOutputDto, dreamLaunchSourceDto, dreamLaunchSourceEnsureInputDto,
  dreamLaunchSourceEnsureOutputDto, type DreamLaunchSourceEnsureInput } from "./dreamLaunchSourceDto";
import { DreamLaunchSourceRepository, type DreamLaunchExistingMessage } from "./dreamLaunchSourceRepository";
import { dreamLaunchSourceEnvelope, dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { projectWorkflowTimestamp } from "./workflowRunService";
import { canonicalBusinessJson } from "./deckContentCanonical";

export const dreamLaunchSourceSchemaRequirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement] as const;
export function validateExistingDreamLaunchSource(row: DreamLaunchExistingMessage, actor: string, input: DreamLaunchSourceEnsureInput, identity: Awaited<ReturnType<typeof dreamLaunchSourceIdentity>>) {
  let metadata: Record<string, unknown> = {};
  try { const decoded: unknown = JSON.parse(row.metadata ?? "{}"); if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) metadata = decoded as Record<string, unknown>; } catch { /* Original invalid JSON cannot establish source scope. */ }
  if (row.thread_id !== identity.threadId || row.user_id !== actor || row.role !== "user" || metadata.kind !== policy.metadataKind || metadata.idempotencyKey !== input.idempotency_key)
    throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_PERMISSION_DENIED", 403);
  if (row.deck_id !== input.deck_id || row.voice_id !== input.agent_id || metadata.deckId !== input.deck_id || metadata.agentId !== input.agent_id || metadata.requestFingerprint !== identity.requestFingerprint)
    throw new AuthBoundaryError("DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", 409);
  return dreamLaunchSourceDto.parse({ thread_id: identity.threadId, message_id: identity.messageId,
    message_time: projectWorkflowTimestamp(row.created_at), request_fingerprint: identity.requestFingerprint, created: false });
}
export async function lookupDreamLaunchReplay(rawInput: unknown, actor: ChatThreadActor & { runScope?: string | null }, tx: DataTransaction) {
  const parsed = dreamLaunchSourceEnsureInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data, principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:read")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || (actor.runScope ?? null) !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const store = new DreamLaunchSourceRepository(tx, principal.canonical_user_id);
  await store.requireScope(input.workspace_id, input.deck_id);
  const replay = await store.scopedReplay(input.workspace_id, input.idempotency_key);
  if (!replay) return dreamLaunchReplayLookupOutputDto.parse({ replay: null });
  const identity = await dreamLaunchSourceIdentity(principal.canonical_user_id, input);
  const source = await store.existingMessage(identity.messageId);
  if (!source) throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_UNAVAILABLE", 503);
  const validated = validateExistingDreamLaunchSource(source, principal.canonical_user_id, input, identity);
  const goalHash = (await canonicalBusinessJson(JSON.stringify({ goal: input.goal }))).content_hash;
  if (replay.preflight_created_by !== principal.canonical_user_id || replay.preflight_deck_id !== input.deck_id ||
    replay.source_voice_thread_id !== identity.threadId || replay.source_message_id !== identity.messageId ||
    projectWorkflowTimestamp(replay.source_message_time) !== validated.message_time || replay.input_hash !== goalHash)
    throw new AuthBoundaryError("DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", 409);
  return dreamLaunchReplayLookupOutputDto.parse({ replay: { workflow_run_id: replay.workflow_run_id,
    workflow_preflight_id: replay.workflow_preflight_id, thread_id: identity.threadId, message_id: identity.messageId } });
}
export async function ensureDreamLaunchSource(rawInput: unknown, actor: ChatThreadActor & { runScope?: string | null }, serviceClientId: string, requestId: string, tx: DataTransaction) {
  const parsed = dreamLaunchSourceEnsureInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data, principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || (actor.runScope ?? null) !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const store = new DreamLaunchSourceRepository(tx, principal.canonical_user_id);
  const identity = await dreamLaunchSourceIdentity(principal.canonical_user_id, input);
  await store.lockSource(input.workspace_id, input.idempotency_key);
  await store.requireScope(input.workspace_id, input.deck_id);
  const existing = await store.existingMessage(identity.messageId);
  const replay = existing ? validateExistingDreamLaunchSource(existing, principal.canonical_user_id, input, identity) : null;
  const result = await new ReceiptRepository(tx, serviceClientId, principal.subject).execute("dream-launch-source.ensure", requestId, input,
    dreamLaunchSourceEnsureOutputDto, async () => {
      if (replay) return { source: replay };
      const thread = await store.existingThread(identity.threadId);
      if (thread && (thread.user_id !== principal.canonical_user_id || thread.deck_id !== input.deck_id || thread.voice_id !== input.agent_id))
        throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_PERMISSION_DENIED", 403);
      const envelope = dreamLaunchSourceEnvelope(principal.canonical_user_id, input, identity.requestFingerprint);
      const now = projectWorkflowTimestamp(await store.clock());
      if (now === null) throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_UNAVAILABLE", 503);
      if (!thread) await store.insertThread(identity.threadId, envelope.title, input.deck_id, input.agent_id);
      await store.insertMessage(identity.messageId, identity.threadId, envelope.parts, envelope.metadata, now);
      return { source: dreamLaunchSourceDto.parse({ thread_id: identity.threadId, message_id: identity.messageId,
        message_time: now, request_fingerprint: identity.requestFingerprint, created: true }) };
    }, identity.threadId);
  if (result.source.thread_id !== identity.threadId || result.source.message_id !== identity.messageId || result.source.request_fingerprint !== identity.requestFingerprint ||
    (replay && result.source.message_time !== replay.message_time) || (!replay && !result.source.created))
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  // A prior receipt must never recover a deleted or reassigned hidden source.
  if (!replay) {
    const current = await store.existingMessage(identity.messageId);
    if (!current || validateExistingDreamLaunchSource(current, principal.canonical_user_id, input, identity).message_time !== result.source.message_time)
      throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_UNAVAILABLE", 503);
  }
  return result;
}
