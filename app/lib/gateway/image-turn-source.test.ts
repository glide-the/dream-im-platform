// [Input] Actual protocol events and the original immutable source repository boundary.
// [Output] Exact real call/output IDs, digest matching and invented/undeclared image call rejection.
// [Pos] Deterministic source observer regression; not semantic-model or real Provider acceptance.
// [Sync] 2026-10-10: save the source before emitting the completed tool block to CLI.
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformTransaction: async (action: (client: unknown) => Promise<unknown>) => action({ marker: "original" }) }));
vi.mock("./image-turn-receipts", async original => ({ ...await original<typeof import("./image-turn-receipts")>(), recordImageSourceOnClient: mocks.record }));
import { ImageTurnSourceObserver } from "./image-turn-source";
import type { ImageTurnContext } from "./image-turn-receipts";
import { operationInputDigest } from "../dream/receipts";
const name = "mcp__image_gen__select_image_operation", args = { operation: "native_generate", prompt: "request", reference_images: [] };
function observer() { return new ImageTurnSourceObserver({} as ImageTurnContext, "req_" + "a".repeat(32), new Set([name])); }
it("preserves Responses item ID separately from real CLI call ID", async () => {
  const value = observer();
  value.provider({ item: { type: "function_call", id: "actual-item", call_id: "actual-call", name, arguments: JSON.stringify(args) } });
  await value.output({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "actual-call", name, input: {} } }, "anthropic");
  await value.output({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } }, "anthropic");
  await value.output({ type: "content_block_stop", index: 0 }, "anthropic");
  expect(mocks.record.mock.lastCall?.[2]).toEqual({ call_id: "actual-call", output_item_id: "actual-item", gateway_request_id: "req_" + "a".repeat(32), tool_name: name, arguments_sha256: operationInputDigest(args) });
});
it("rejects a projected name or argument change even with the same real call ID", async () => {
  for (const changed of [{ name, input: { ...args, prompt: "changed" } }, { name: "mcp__image_gen__imagegen", input: args }]) {
    const value = observer(); value.provider({ item: { type: "function_call", id: "item", call_id: "call", name, arguments: JSON.stringify(args) } });
    await value.output({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call", ...changed } }, "anthropic");
    await expect(value.output({ type: "content_block_stop", index: 0 }, "anthropic")).rejects.toMatchObject({ code: "IMAGE_TURN_SOURCE_INVALID" });
  }
});
it("rejects an adapter-invented call ID and invalid selection arguments", async () => {
  for (const input of [args, { ...args, user_id: "caller" }]) {
    const value = observer(); await value.output({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "synthetic", name, input } }, "anthropic");
    await expect(value.output({ type: "content_block_stop", index: 0 }, "anthropic")).rejects.toMatchObject({ code: "IMAGE_TURN_SOURCE_INVALID" });
  }
});
