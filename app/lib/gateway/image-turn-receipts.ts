// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Verified Gateway delegation, server-owned turn key and one original PostgreSQL transaction client.
// [Output] Immutable image source/selection/claim facts with entity matching and one external execution per turn.
// [Pos] Images-only gate inside the existing Gateway transaction; no DDL, second pool or Provider replay.
// [Sync] 2026-10-10: preserve distinct upstream item, CLI call, broker and Gateway request identities.
import type { PoolClient } from "pg";
import { z } from "zod";
import type { GatewayPrincipal } from "./auth";
import { GatewayError } from "./errors";
import { operationInputDigest } from "../dream/receipts";
import { createPlatformId } from "../platform-ids";
import { imageTurnCapabilityAvailable } from "../db/image-turn-capability";
import { lockGatewayAccountOnClient } from "./account-lock";
import { imageTurnBindOutputDto, imageTurnSelectOutputDto, imageSourceDto, imageExecutionClaimDto,
  imageTurnKeyDto, imageTurnReceiptKey, imageTurnIdentityLockKey, type ImageTurnBinding, type ImageTurnSelection } from "../dream/imageTurnDto";
import { nativeImageSummaryDto } from "../dream/imageTurnDto";
import { normalizedImageMaterialsDto } from "./image-turn-materials";
export { imageTurnReceiptKey } from "../dream/imageTurnDto";

type RuntimeIdentity = NonNullable<GatewayPrincipal["runtimeIdentity"]>;
export type ImageTurnContext = Readonly<{ identity: RuntimeIdentity; platformUserId: string; turnKey: string }>;
export function imageTurnLockKey(context: ImageTurnContext) {
  return imageTurnIdentityLockKey(context.identity.serviceClientId, context.identity.authSubject, context.turnKey);
}
export function imageTurnContext(principal: GatewayPrincipal, turnKey: unknown): ImageTurnContext {
  const parsed = imageTurnKeyDto.safeParse(turnKey);
  const identity = principal.runtimeIdentity;
  if (!parsed.success || !identity || identity.purpose !== "gateway-cli" || !identity.threadId
    || !identity.serviceClientId || !identity.authSubject || !identity.canonicalUserId) {
    throw new GatewayError("IMAGE_TURN_AUTHORITY_REQUIRED", "This image operation requires the authenticated conversation turn", 403, "permission_error");
  }
  return Object.freeze({ identity, platformUserId: principal.platformUserId, turnKey: parsed.data });
}
export async function lockImageTurnOnClient(client: PoolClient, context: ImageTurnContext) {
  if (!await imageTurnCapabilityAvailable(client)) throw new GatewayError("IMAGE_TURN_CONFIGURATION_UNAVAILABLE", "The image turn contract or Gateway role permissions are unavailable", 503, "configuration_error");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [imageTurnLockKey(context)]);
}
async function readFact<T extends z.ZodType>(client: PoolClient, context: ImageTurnContext,
  operation: string, key: string, output: T): Promise<z.output<T> | null> {
  const result = await client.query<{ input_sha256: string; result: unknown }>(
    `SELECT input_sha256, result FROM dream.operation_receipts
     WHERE service_client_id = $1 AND actor = $2 AND operation = $3 AND request_id = $4`,
    [context.identity.serviceClientId, context.identity.authSubject, operation, key]);
  const row = result.rows[0];
  if (!row) return null;
  const checked = z.strictObject({ schema_version: z.literal(1), data: z.json(), thread_scope: z.string().nullable(),
    editor_session_scope: z.string().nullable().optional(), run_scope: z.string().nullable().optional() }).safeParse(row.result);
  const envelope = checked.success ? checked.data : null;
  if (!envelope || envelope.thread_scope !== context.identity.threadId || (envelope.editor_session_scope ?? null) !== null
    || (envelope.run_scope ?? null) !== context.identity.runId) {
    throw new GatewayError("IMAGE_TURN_RECEIPT_INVALID", "The image operation receipt does not match the authenticated entity", 503, "configuration_error");
  }
  const parsed = output.safeParse(envelope.data);
  if (!parsed.success) throw new GatewayError("IMAGE_TURN_RECEIPT_INVALID", "The image operation receipt is invalid", 503, "configuration_error");
  return parsed.data;
}
async function appendFact<T extends z.ZodType>(client: PoolClient, context: ImageTurnContext,
  operation: string, key: string, value: z.input<T>, schema: T): Promise<z.output<T>> {
  const data = schema.parse(value), inputHash = operationInputDigest(data);
  // Caller holds the turn transaction lock. Never replace an existing fact.
  const prior = await readFact(client, context, operation, key, schema);
  if (prior !== null) {
    if (operationInputDigest(prior) !== inputHash) throw new GatewayError("IMAGE_TURN_CONFLICT", "The image operation has already been recorded with different input", 409, "invalid_request_error");
    return prior;
  }
  await client.query(`INSERT INTO dream.operation_receipts
    (service_client_id, actor, operation, request_id, input_sha256, result)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [context.identity.serviceClientId, context.identity.authSubject, operation, key, inputHash,
      JSON.stringify({ schema_version: 1, data, thread_scope: context.identity.threadId, run_scope: context.identity.runId })]);
  await client.query(`INSERT INTO public.admin_audit_logs
    (id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)
    VALUES ($1, 'service', $2, $3, 'dream_operation', $4, $5, $6::jsonb)`,
    [createPlatformId("audit"), context.identity.serviceClientId, `dream.${operation}`, key, key, JSON.stringify({ input_sha256: inputHash })]);
  return data;
}
export async function readImageTurnOnClient(client: PoolClient, context: ImageTurnContext): Promise<{
  binding: ImageTurnBinding; selection: ImageTurnSelection | null;
  claim: z.infer<typeof imageExecutionClaimDto> | null;
}> {
  const binding = await readFact(client, context, "image-turn.bind", imageTurnReceiptKey(context.turnKey), imageTurnBindOutputDto);
  if (!binding || binding.turn_key !== context.turnKey || binding.thread_id !== context.identity.threadId
    || binding.run_id !== context.identity.runId || binding.canonical_user_id !== context.identity.canonicalUserId) {
    throw new GatewayError("IMAGE_TURN_NOT_BOUND", "The conversation image operation is not bound to a saved user message", 409, "invalid_request_error");
  }
  return { binding,
    selection: await readFact(client, context, "image-turn.select", imageTurnReceiptKey(context.turnKey), imageTurnSelectOutputDto),
    claim: await readFact(client, context, "image-turn.execution", imageTurnReceiptKey(context.turnKey), imageExecutionClaimDto) };
}
export async function recordImageSourceOnClient(client: PoolClient, context: ImageTurnContext, source: z.input<typeof imageSourceDto>) {
  await lockGatewayAccountOnClient(client, context.platformUserId);
  await lockImageTurnOnClient(client, context);
  await readImageTurnOnClient(client, context);
  const parsed = imageSourceDto.parse(source);
  return appendFact(client, context, "image-turn.source", imageTurnReceiptKey(context.turnKey, parsed.call_id), parsed, imageSourceDto);
}
export async function normalizeImageMaterialsOnClient(client: PoolClient, context: ImageTurnContext, materials: z.input<typeof normalizedImageMaterialsDto>) {
  // Preparation holds the original account then turn lock.
  return appendFact(client, context, "image-turn.materials", imageTurnReceiptKey(context.turnKey), materials, normalizedImageMaterialsDto);
}
export async function readImageSourceOnClient(client: PoolClient, context: ImageTurnContext, callId: string) {
  return readFact(client, context, "image-turn.source", imageTurnReceiptKey(context.turnKey, callId), imageSourceDto);
}
export type ImageExecutionSource = { callId: string; argumentsSha256: string; selectionArgumentsSha256: string; materialSha256: string[] };
export async function claimImageExecutionOnClient(client: PoolClient, context: ImageTurnContext, claim: z.input<typeof imageExecutionClaimDto>, executionSource?: ImageExecutionSource) {
  // The existing request creator locks account, then turn, then idempotency.
  // It calls this before returning reserved, on the same transaction client.
  const parsed = imageExecutionClaimDto.parse(claim);
  await validateImageExecutionOnClient(client, context, parsed, executionSource);
  return appendFact(client, context, "image-turn.execution", imageTurnReceiptKey(context.turnKey), parsed, imageExecutionClaimDto);
}
export async function validateImageExecutionOnClient(client: PoolClient, context: ImageTurnContext,
  input: Pick<z.infer<typeof imageExecutionClaimDto>, "operation" | "selected_model" | "selection_call_id">,
  executionSource?: ImageExecutionSource) {
  const state = await readImageTurnOnClient(client, context);
  const parsed = input;
  const expectedModel = parsed.operation.startsWith("native_") ? state.binding.ai_model : state.binding.image_model;
  if (!state.selection || state.selection.operation !== parsed.operation || state.selection.source_call_id !== parsed.selection_call_id
    || expectedModel !== parsed.selected_model) {
    throw new GatewayError("IMAGE_TURN_SELECTION_MISMATCH", "The selected image route, operation or model does not match this request", 409, "invalid_request_error");
  }
  if (state.claim) throw new GatewayError("IMAGE_TURN_ALREADY_EXECUTED", "This conversation turn already has an image execution; the request was not repeated", 409, "invalid_request_error");
  if (parsed.operation.startsWith("image_gen_")) {
    const source = executionSource && await readImageSourceOnClient(client, context, executionSource.callId);
    const selected = state.selection.reference_images.map(uri => state.binding.materials.find(material => material.uri === uri));
    if (!source || source.tool_name !== "mcp__image_gen__imagegen" || source.arguments_sha256 !== executionSource?.argumentsSha256
      || !executionSource || state.selection.arguments_sha256 !== executionSource.selectionArgumentsSha256 || selected.some(material => material === undefined)
      || operationInputDigest(selected.map(material => material!.sha256)) !== operationInputDigest(executionSource.materialSha256)
      || (parsed.operation === "image_gen_edit") !== (selected.length > 0)) {
      throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "The Images call or current material does not match the recorded CLI tool execution", 409, "invalid_request_error");
    }
  }
  return state;
}
export async function recordNativeImageResultOnClient(client: PoolClient, context: ImageTurnContext, summary: z.input<typeof nativeImageSummaryDto>) {
  await lockGatewayAccountOnClient(client, context.platformUserId);
  await lockImageTurnOnClient(client, context);
  const state = await readImageTurnOnClient(client, context);
  if (!state.claim || !state.claim.operation.startsWith("native_") || state.claim.gateway_request_id !== summary.gatewayRequestId) {
    throw new GatewayError("IMAGE_TURN_RESULT_MISMATCH", "The image result does not match the reserved native execution", 409, "invalid_request_error");
  }
  return appendFact(client, context, "image-turn.result", imageTurnReceiptKey(context.turnKey), summary, nativeImageSummaryDto);
}
