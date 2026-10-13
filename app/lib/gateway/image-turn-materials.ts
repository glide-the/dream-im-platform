// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Bound saved-message identity and the actual direct CLI user image blocks.
// [Output] Current-message image bytes and separate immutable normalized digests.
// [Pos] Gateway image-only input boundary; never grants history or tool-output images.
// [Sync] 2026-10-10: bind ordered URI labels after CLI resizing without equating source and wire hashes.
// [Sync] 2026-10-11: report fixed rejection stages/counts without recording message or material contents.
// [Sync] 2026-10-11: locate the exact current marker after CLI recovery prefixes; never authorize prefix images.
import { createHash } from "node:crypto";
import { z } from "zod";
import { imageDigestDto, imageReferenceUriDto, type ImageTurnBinding } from "../dream/imageTurnDto";
import { record } from "./protocol-adapters";
import { GatewayError } from "./errors";
import { validateBase64Image } from "./image-protocols";
import { imageApiPolicy } from "../../../config/image-api-policy";
type Json = Record<string, unknown>;
export const normalizedImageMaterialsDto = z.array(z.strictObject({ uri: imageReferenceUriDto,
  sha256: imageDigestDto, media_type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), byte_length: z.number().int().positive() }));
export function imageMaterialHeader(binding: Pick<ImageTurnBinding, "turn_key" | "message_id">) {
  return `[Ink image materials: ${binding.turn_key} ${binding.message_id}]`;
}
type RejectionStage = "marker-occurrence" | "marked-frame" | "marker-position-and-binding" | "trailing-blocks" | "material-pair" | "image-decode" | "image-bytes";
type MaterialCounts = { messageCount: number; arrayContentFrames: number; stringContentFrames: number;
  markerOccurrences: number; materialCount: number; markedCount?: number; blockCount?: number; markerIndex?: number;
  wholeMarkerBlockCount?: number; containingMarkerBlockIndex?: number; pairIndex?: number };
function invalid(stage: RejectionStage, counts: MaterialCounts) {
  // Diagnostics must never carry the request, binding, decoder error or body contents.
  // A failed log sink must preserve the original rejection and HTTP classification.
  try { console.warn("[gateway:image-materials]", stage, counts); } catch { /* best-effort diagnostics */ }
  return new GatewayError("IMAGE_MATERIALS_MISMATCH", "The current image material cannot be verified. Add the image to a new message and send it again", 409, "invalid_request_error");
}
export function knownCliUserContextPrefix(value: unknown) {
  return typeof value === "string" && value.startsWith("<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# ")
    && value.endsWith("\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n\n")
    && value.split("<system-reminder>").length === 2 && value.split("</system-reminder>").length === 2;
}
export async function currentImageMaterials(body: Json, binding: ImageTurnBinding) {
  const marker = imageMaterialHeader(binding);
  const messages = (Array.isArray(body.messages) ? body.messages : []).map(record).filter(value => value !== null);
  const counts: MaterialCounts = { messageCount: messages.length,
    arrayContentFrames: messages.filter(message => Array.isArray(message.content)).length,
    stringContentFrames: messages.filter(message => typeof message.content === "string").length,
    markerOccurrences: JSON.stringify(body.messages).split(marker).length - 1, materialCount: binding.materials.length };
  if (counts.markerOccurrences !== 1) throw invalid("marker-occurrence", counts);
  const marked = messages.filter(message => Array.isArray(message.content) && message.content.some(block => {
    const value = record(block); return value?.type === "text" && typeof value.text === "string" && value.text.includes(marker);
  }));
  counts.markedCount = marked.length;
  if (marked.length !== 1 || marked[0].role !== "user" || !Array.isArray(marked[0].content)) throw invalid("marked-frame", counts);
  const blocks = marked[0].content.map(record);
  counts.blockCount = blocks.length;
  // CLI recovery merges an unfinished user frame with the new one. Only the
  // bound exact block and its following pairs identify this turn's materials.
  const markerIndex = blocks.findIndex(block => block?.type === "text" && block.text === marker);
  counts.markerIndex = markerIndex;
  counts.wholeMarkerBlockCount = blocks.filter(block => block?.type === "text" && block.text === marker).length;
  counts.containingMarkerBlockIndex = blocks.findIndex(block => block?.type === "text" && typeof block.text === "string" && block.text.includes(marker));
  if (markerIndex < 0 || blocks[markerIndex]?.type !== "text" || blocks[markerIndex].text !== marker
    || blocks.filter(block => block?.type === "text" && typeof block.text === "string" && block.text.includes(marker)).length !== 1
    || binding.materials.length > imageApiPolicy.maxInputImages || new Set(binding.materials.map(value => value.uri)).size !== binding.materials.length) throw invalid("marker-position-and-binding", counts);
  const pairs = binding.materials.map((_, index) => ({ block: blocks[markerIndex + 1 + index * 2], label: blocks[markerIndex + 2 + index * 2] }));
  if (blocks.slice(markerIndex + 1 + pairs.length * 2).some(block => block?.type !== "text"
    || typeof block.text !== "string" || block.text.startsWith("Reference image for editing: "))) throw invalid("trailing-blocks", counts);
  let total = 0;
  const images: { uri: string; image: Json }[] = [], normalized: z.infer<typeof normalizedImageMaterialsDto> = [];
  for (let index = 0; index < pairs.length; index++) {
    const { block, label } = pairs[index], material = binding.materials[index], source = record(block?.source);
    if (block?.type !== "image" || label?.type !== "text" || label.text !== `Reference image for editing: ${material.uri}`
      || source?.type !== "base64" || typeof source.data !== "string") throw invalid("material-pair", { ...counts, pairIndex: index });
    let media: string;
    try { media = await validateBase64Image(source.data, true); } catch { throw invalid("image-decode", { ...counts, pairIndex: index }); }
    const bytes = Buffer.from(source.data, "base64"); total += bytes.byteLength;
    if (bytes.toString("base64") !== source.data || source.media_type !== media || total > imageApiPolicy.maxMultipartBytes) throw invalid("image-bytes", { ...counts, pairIndex: index });
    normalized.push({ uri: material.uri, sha256: createHash("sha256").update(bytes).digest("hex"),
      media_type: media as "image/png" | "image/jpeg" | "image/webp" | "image/gif", byte_length: bytes.byteLength });
    images.push({ uri: material.uri, image: block! });
  }
  return { images, normalized };
}
export function nativeImageConversationBody(body: Json, selected: { uri: string; image: Json }[], prompt: string) {
  // Selection function calls are already authenticated and persisted. They
  // are not function tools on this forced server-tool execution request.
  const messages = (Array.isArray(body.messages) ? body.messages : []).flatMap(message => {
    const value = record(message);
    if (!value || !Array.isArray(value.content)) return [];
    const content = value.content.filter(block => {
      const part = record(block);
      return part?.type === "text" && typeof part.text === "string"
        && !part.text.startsWith("[Ink image materials: ") && !part.text.startsWith("Reference image for editing: ");
    });
    return content.length ? [{ ...value, content }] : [];
  });
  return { ...body, messages: [...messages, { role: "user", content: [
    ...selected.map(value => value.image), { type: "text", text: prompt },
  ] }] };
}
