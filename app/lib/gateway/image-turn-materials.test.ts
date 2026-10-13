// [Input] Actual-style CLI image frames and server-bound material facts.
// [Output] Resize identity, exact frame/ordering rejection and selected-only native input evidence.
// [Pos] Provider-free material boundary tests; no model or normal database.
// [Sync] 2026-10-10: include the installed CLI's context prefix and current-message isolation.
// [Sync] 2026-10-11: rejection diagnostics contain only fixed stages/counts and preserve errors if logging fails.
// [Sync] 2026-10-11: merged recovery prefixes never authorize old images, including empty current bindings.
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { currentImageMaterials, imageMaterialHeader, nativeImageConversationBody } from "./image-turn-materials";
import type { ImageTurnBinding } from "../dream/imageTurnDto";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const binding: ImageTurnBinding = { thread_id: "thread", turn_id: "turn", turn_key: "dream-turn-" + "a".repeat(64),
  message_id: "private-bound-message-sentinel", ai_model: "ai", image_model: "image", canonical_user_id: "7", run_id: null,
  materials: [{ uri: "workspace://files/a.png", sha256: "b".repeat(64) }] };
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: png } };
const header = { type: "text", text: imageMaterialHeader(binding) }, label = { type: "text", text: "Reference image for editing: workspace://files/a.png" };
const text = { type: "text", text: "Edit the current image" };
const prefix = { type: "text", text: "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# currentDate\n2026-10-10\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n\n" };
function body(content: unknown[], messages: unknown[] = []) { return { messages: [...messages, { role: "user", content }] }; }
it("binds real normalized bytes without equating the original file and resized wire hash", async () => {
  for (const blocks of [[header, image, label, text], [prefix, header, image, label, text]]) {
    const result = await currentImageMaterials(body(blocks), binding);
    expect(result.images).toEqual([{ uri: binding.materials[0].uri, image }]);
    expect(result.normalized[0]).toEqual({ uri: binding.materials[0].uri, sha256: createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"), media_type: "image/png", byte_length: Buffer.from(png, "base64").byteLength });
    expect(result.normalized[0].sha256).not.toBe(binding.materials[0].sha256);
  }
});
it.each([
  [{ ...header, text: `${header.text}\n` }, image, label], [header, text, image, label],
  [header, image, text, label], [header, image, label, image], [header, image, label, label],
  [header, image, { ...label, text: "Reference image for editing: workspace://files/other.png" }],
  [header, image, label, { type: "tool_result", content: [text] }],
  [header, image, label, { ...text, text: imageMaterialHeader(binding) }],
].map(blocks => ({ blocks })))("rejects a concatenated marker, noncontiguous pair, extra material or duplicate", async ({ blocks }) => {
  await expect(currentImageMaterials(body(blocks), binding)).rejects.toMatchObject({ code: "IMAGE_MATERIALS_MISMATCH" });
});
it("does not grant a marker nested inside tool outputs", async () => {
  await expect(currentImageMaterials(body([{ type: "tool_result", content: [header, image, label] }]), binding)).rejects.toMatchObject({ code: "IMAGE_MATERIALS_MISMATCH" });
});
it("locates a current exact block after CLI context and unfinished recovery prefixes", async () => {
  for (const blocks of [[text, header, image, label], [prefix, prefix, header, image, label], [prefix, header, image, label]]) {
    const result = await currentImageMaterials(body(blocks, [{ role: "user", content: [text] }]), binding);
    expect(result.images).toEqual([{ uri: binding.materials[0].uri, image }]);
  }
});
it("authorizes only pairs after the current marker, never images or tool outputs in a merged prefix", async () => {
  const oldHeader = { type: "text", text: imageMaterialHeader({ turn_key: "dream-turn-" + "c".repeat(64), message_id: "previous-message" }) };
  const oldImage = { type: "image", source: { type: "base64", media_type: "image/png", data: "historical-image-not-selected" } };
  const blocks = [oldHeader, oldImage, { type: "text", text: "Reference image for editing: workspace://files/old.png" },
    { type: "tool_result", content: [oldImage] }, text, header, image, label, text];
  const checked = await currentImageMaterials(body(blocks), binding);
  expect(checked.images).toEqual([{ uri: binding.materials[0].uri, image }]);
  expect(checked.normalized.map(value => value.uri)).toEqual([binding.materials[0].uri]);
  const native = nativeImageConversationBody(body(blocks), checked.images, "Selected current operation");
  expect(JSON.stringify(native)).not.toContain("historical-image-not-selected");
  expect(native.messages.at(-1)?.content).toEqual([image, { type: "text", text: "Selected current operation" }]);
});
it("an empty current binding cannot gain a prior prefix image", async () => {
  const empty = { ...binding, materials: [] };
  const checked = await currentImageMaterials(body([image, label, text, header, text]), empty);
  expect(checked).toEqual({ images: [], normalized: [] });
});
it("removes every prior image/function envelope and adds only the selected current image", () => {
  const request = body([header, image, label, text], [{ role: "assistant", content: [{ type: "server_tool_use", id: "old" }, { type: "image_generation_tool_result", content: [image] }] },
    { role: "user", content: [{ ...image, source: { ...image.source, data: "other" } }, text] }]);
  const result = nativeImageConversationBody(request, [{ uri: binding.materials[0].uri, image }], "Selected operation");
  const encoded = JSON.stringify(result);
  expect(encoded).not.toContain("other"); expect(encoded).not.toContain("server_tool_use"); expect(encoded).not.toContain("Reference image");
  expect(result.messages.at(-1)).toEqual({ role: "user", content: [image, { type: "text", text: "Selected operation" }] });
});
it('retains original GIF understanding without authorizing a different image route', async () => {
  const gif = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const gifImage = {type:'image',source:{type:'base64',media_type:'image/gif',data:gif}};
  const checked = await currentImageMaterials(body([header,gifImage,label,{type:'text',text:'Describe this GIF'}]),binding);
  expect(checked.normalized[0].media_type).toBe('image/gif');
  expect(checked.images[0].image).toEqual(gifImage);
});
it("reports a fixed rejection stage without message, marker, URI or image contents", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await expect(currentImageMaterials(body([header, image, label, { type: "tool_result", content: "private-body-sentinel" }]), binding))
      .rejects.toMatchObject({ code: "IMAGE_MATERIALS_MISMATCH", status: 409 });
    expect(log).toHaveBeenCalledExactlyOnceWith("[gateway:image-materials]", "trailing-blocks", {
      messageCount: 1, arrayContentFrames: 1, stringContentFrames: 0, markerOccurrences: 1,
      materialCount: 1, markedCount: 1, blockCount: 4, markerIndex: 0,
      wholeMarkerBlockCount: 1, containingMarkerBlockIndex: 0,
    });
    const encoded = JSON.stringify(log.mock.calls);
    for (const value of [header.text, binding.turn_key, binding.message_id, binding.materials[0].uri, png, "private-body-sentinel"])
      expect(encoded).not.toContain(value);
  } finally { log.mockRestore(); }
});
it("preserves the public mismatch classification if the diagnostic sink fails", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("private-sink-error"); });
  try {
    await expect(currentImageMaterials(body([text]), binding)).rejects.toMatchObject({
      code: "IMAGE_MATERIALS_MISMATCH", status: 409,
      message: "The current image material cannot be verified. Add the image to a new message and send it again",
    });
  } finally { log.mockRestore(); }
});
