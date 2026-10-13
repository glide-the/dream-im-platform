// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Verified server-persistence delegation, saved user message and actual model proposal source.
// [Output] Immutable turn binding or semantic selection on the existing data transaction.
// [Pos] Image-only named domain; it never controls Runner or performs Gateway accounting in a second pool.
// [Sync] 2026-10-10: require actual upstream proposal/digest before accepting a CLI selection.
import { sql } from "drizzle-orm";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { imageTurnSchemaRequirement } from "../db/image-turn-capability";
import { AuthBoundaryError } from "../auth/config";
import type { DelegatedPrincipal } from "../auth/delegationService";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { ChatThreadRepository } from "./chatThreadRepository";
import { imageTurnOperationContracts, imageTurnBindInputDto, imageTurnBindOutputDto, imageTurnSelectInputDto,
  imageTurnSelectOutputDto, imageSourceDto, imageSelectionToolName, imageTurnReceiptKey, imageTurnIdentityLockKey,
  type ImageTurnOperation } from "./imageTurnDto";
import { imageTurnResultInputDto, nativeImageSummaryDto } from "./imageTurnDto";
export const imageTurnSchemaRequirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement,
  runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, imageTurnSchemaRequirement] as const;

export async function executeImageTurnOperation(tx: DataTransaction, authority: DelegatedPrincipal,
  name: ImageTurnOperation, requestId: string, raw: unknown) {
  const contract = imageTurnOperationContracts[name];
  const input = contract.input.parse(raw);
  if (authority.purpose !== "server-persistence" || authority.editorSessionId !== null
    || authority.threadId !== input.thread_id || !authority.principal.scopes.includes("dream:write")) {
    throw new AuthBoundaryError("IMAGE_TURN_AUTHORITY_REQUIRED", 403);
  }
  const key = imageTurnReceiptKey(input.turn_key);
  if (name !== "image-turn.result" && requestId !== key) throw new AuthBoundaryError("IMAGE_TURN_REQUEST_ID_INVALID", 400);
  const repository = new ReceiptRepository(tx, authority.serviceClientId, authority.principal.subject);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${imageTurnIdentityLockKey(authority.serviceClientId, authority.principal.subject, input.turn_key)}, 0))`);
  await new ChatThreadRepository(tx, authority.principal.canonical_user_id).requireOwned(input.thread_id);
  if (name === "image-turn.result") {
    const value = imageTurnResultInputDto.parse(input);
    const row = await repository.find(name, key);
    const result = nativeImageSummaryDto.safeParse(row?.result);
    if (!row || !result.success || row.threadScope !== authority.threadId || row.runScope !== authority.runId || row.editorSessionScope !== null
      || result.data.gatewayRequestId !== value.gateway_request_id || !result.data.imageCalls.some(call => call.callId === value.call_id)) {
      throw new AuthBoundaryError("IMAGE_TURN_RESULT_UNAVAILABLE", 404);
    }
    return result.data;
  }
  if (name === "image-turn.bind") {
    const value = imageTurnBindInputDto.parse(input);
    const message = await tx.execute(sql`SELECT id FROM public.chat_message WHERE id = ${value.message_id}
      AND thread_id = ${value.thread_id} AND role = 'user'`);
    if (!message.rows.length) throw new AuthBoundaryError("IMAGE_TURN_MESSAGE_NOT_FOUND", 404);
    if (new Set(value.materials.map(item => item.uri)).size !== value.materials.length) throw new AuthBoundaryError("IMAGE_TURN_MATERIAL_INVALID", 400);
    return repository.execute(name, key, value, imageTurnBindOutputDto, async () => ({ ...value,
      canonical_user_id: authority.principal.canonical_user_id, run_id: authority.runId }), value.thread_id, null, authority.runId);
  }
  const value = imageTurnSelectInputDto.parse(input);
  const row = await repository.find("image-turn.bind", key);
  const binding = imageTurnBindOutputDto.safeParse(row?.result);
  if (!row || !binding.success || row.threadScope !== authority.threadId || row.runScope !== authority.runId
    || row.editorSessionScope !== null || binding.data.canonical_user_id !== authority.principal.canonical_user_id
    || binding.data.turn_key !== value.turn_key || binding.data.thread_id !== value.thread_id || binding.data.run_id !== authority.runId) {
    throw new AuthBoundaryError("IMAGE_TURN_NOT_BOUND", 409);
  }
  const sourceRow = await repository.find("image-turn.source", imageTurnReceiptKey(value.turn_key, value.source_call_id));
  const source = imageSourceDto.safeParse(sourceRow?.result);
  const digest = operationInputDigest(value.arguments);
  if (!sourceRow || !source.success || sourceRow.threadScope !== authority.threadId || sourceRow.runScope !== authority.runId
    || sourceRow.editorSessionScope !== null || source.data.tool_name !== imageSelectionToolName
    || source.data.call_id !== value.source_call_id || source.data.arguments_sha256 !== digest) {
    throw new AuthBoundaryError("IMAGE_TURN_SOURCE_MISMATCH", 403);
  }
  const available = new Set(binding.data.materials.map(item => item.uri));
  if (value.arguments.reference_images.some(uri => !available.has(uri))
    || new Set(value.arguments.reference_images).size !== value.arguments.reference_images.length) {
    throw new AuthBoundaryError("IMAGE_TURN_MATERIAL_INVALID", 403);
  }
  return repository.execute(name, key, value, imageTurnSelectOutputDto, async () => {
    // Original receipt replay remains readable after execution. Only a new
    // decision may be rejected by an existing execution fact.
    if (await repository.find("image-turn.execution", key)) throw new AuthBoundaryError("IMAGE_TURN_ALREADY_EXECUTED", 409);
    return { turn_key: value.turn_key, source_call_id: value.source_call_id,
      operation: value.arguments.operation, arguments_sha256: digest,
      reference_images: value.arguments.reference_images };
  }, value.thread_id, null, authority.runId);
}
