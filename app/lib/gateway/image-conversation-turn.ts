// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Verified CLI principal, resolved AI model and the saved image turn on the original PostgreSQL pool.
// [Output] Frozen route/operation and a filtered original tool list; no name-based intent matching.
// [Pos] Image-only Messages preparation; other tools and normal text keep their existing path.
// [Sync] 2026-10-10: open exactly one image route after the main model's recorded semantic choice.
// [Sync] 2026-10-11: accept declared Codex native capabilities without using Images model facts.
// [Sync] 2026-10-11: recognize the resolver's single default Provider snapshot; effective routing remains rejected.
import { withPlatformTransaction } from "../platform-db";
import { lockGatewayAccountOnClient } from "./account-lock";
import { imageTurnContext, lockImageTurnOnClient, readImageTurnOnClient, normalizeImageMaterialsOnClient, type ImageTurnContext } from "./image-turn-receipts";
import { currentImageMaterials, nativeImageConversationBody } from "./image-turn-materials";
import { imageSelectionToolName, imageExecutionToolName, imageSelectionArgumentsDto, type ImageTurnSelection } from "../dream/imageTurnDto";
import { operationInputDigest } from "../dream/receipts";
import { resolveResponsesAdapter } from "./provider-endpoint";
import type { GatewayPrincipal } from "./auth";
import type { ResolvedBillableModel } from "../models/resolver";
import { record } from "./protocol-adapters";
import { GatewayError } from "./errors";
type Json = Record<string, unknown>;
export type NativeImageTurn = { context: ImageTurnContext; selection: ImageTurnSelection; prompt: string; inputImages: number; executionBody: Json };
export async function prepareConversationImageTurn(input: { principal: GatewayPrincipal; resolved: ResolvedBillableModel; turnKey: string; body: Json }) {
  const context = imageTurnContext(input.principal, input.turnKey);
  const state = await withPlatformTransaction(async client => {
    await lockGatewayAccountOnClient(client, context.platformUserId);
    await lockImageTurnOnClient(client, context);
    const state = await readImageTurnOnClient(client, context);
    const materials = await currentImageMaterials(input.body, state.binding);
    await normalizeImageMaterialsOnClient(client, context, materials.normalized);
    return { ...state, materials };
  });
  if (state.binding.ai_model !== input.body.model) throw new GatewayError("IMAGE_TURN_MODEL_MISMATCH", "The AI model does not match the saved conversation turn", 409, "invalid_request_error");
  const tools = (Array.isArray(input.body.tools) ? input.body.tools : []).filter(tool => {
    const name = record(tool)?.name;
    if (name !== imageSelectionToolName && name !== imageExecutionToolName) return true;
    if (state.claim) return false;
    return state.selection === null ? name === imageSelectionToolName
      : state.selection.operation.startsWith("image_gen_") && name === imageExecutionToolName;
  });
  const body = { ...input.body, tools };
  const nativeSelected = state.selection?.operation.startsWith("native_") && !state.claim;
  if (!nativeSelected) return { body, context, native: undefined };
  const selection = state.selection!;
  const capability = selection.operation === "native_edit" ? "responses_image_edit" : "responses_image_generation";
  const routing = input.resolved.routing;
  const defaultProvider = !routing || (routing.snapshot.strategy === "default" && !routing.snapshot.allowFallbacks
    && routing.snapshot.candidates.length === 1 && routing.candidates.length === 1 && routing.snapshot.excluded.length === 0
    && routing.snapshot.candidates[0].providerId === input.resolved.provider.id
    && routing.snapshot.candidates[0].upstreamModel === input.resolved.model.upstreamModel
    && routing.candidates[0].provider.id === input.resolved.provider.id
    && routing.candidates[0].upstreamModel === input.resolved.model.upstreamModel);
  if (input.resolved.model.capabilities[capability] !== true || input.resolved.model.capabilities.chat !== true
    || input.resolved.model.capabilities.tools !== true || !["openai", "codex"].includes(resolveResponsesAdapter(input.resolved.provider) ?? "")
    || !defaultProvider || !input.resolved.model.imageOutputTokenReservePerImage
    || (selection.reference_images.length > 0 && !input.resolved.model.imageInputTokenReservePerImage)) {
    throw new GatewayError("AI_MODEL_IMAGE_OPERATION_UNAVAILABLE", "This AI model cannot perform the selected Responses image operation. Choose an available AI model in Settings, or send a new explicit image_gen request with an Image model", 409, "configuration_error");
  }
  const proposals = (Array.isArray(input.body.messages) ? input.body.messages : []).flatMap(message => {
    const value = record(message);
    return value?.role === "assistant" && Array.isArray(value.content) ? value.content : [];
  }).filter(block => record(block)?.type === "tool_use" && record(block)?.id === selection.source_call_id && record(block)?.name === imageSelectionToolName);
  if (proposals.length !== 1) throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "The saved selection source is missing from the CLI conversation", 409, "invalid_request_error");
  const args = imageSelectionArgumentsDto.safeParse(record(proposals[0])?.input);
  if (!args.success || operationInputDigest(args.data) !== selection.arguments_sha256) throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "The selection arguments do not match the saved source", 409, "invalid_request_error");
  if (selection.operation === "native_edit" && !selection.reference_images.length) throw new GatewayError("IMAGE_REFERENCE_REQUIRED", "Add an image or select an existing conversation image before editing", 409, "invalid_request_error");
  const selected = selection.reference_images.map(uri => state.materials.images.find(image => image.uri === uri));
  if (selected.some(image => image === undefined) || new Set(selection.reference_images).size !== selected.length) throw new GatewayError("IMAGE_REFERENCE_REQUIRED", "Add the selected image to the current message before editing", 409, "invalid_request_error");
  if (selected.some(image => record(image?.image.source)?.media_type === "image/gif")) throw new GatewayError("IMAGE_MATERIAL_OPERATION_UNSUPPORTED", "This GIF can be viewed in the conversation. For an image operation, add a PNG, JPEG or WebP image to the current message", 409, "invalid_request_error");
  return { body, context, native: { context, selection, prompt: args.data.prompt, inputImages: selected.length,
    executionBody: nativeImageConversationBody(body, selected as { uri: string; image: Json }[], args.data.prompt) } satisfies NativeImageTurn };
}
