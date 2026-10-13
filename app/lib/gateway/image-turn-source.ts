// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Actual Provider call identities and original projected Anthropic tool blocks.
// [Output] Immutable source receipts before CLI sees the completed image-only tool call.
// [Pos] Observer on the existing proxy stream; it does not classify user text or execute a tool.
// [Sync] 2026-10-10: match real Provider IDs and exact arguments before granting image operations.
import { withPlatformTransaction } from "../platform-db";
import { operationInputDigest } from "../dream/receipts";
import { imageSelectionToolName, imageExecutionToolName, imageCallIdDto, imageSelectionArgumentsDto } from "../dream/imageTurnDto";
import { GatewayError } from "./errors";
import { record, type GatewayProtocol } from "./protocol-adapters";
import { recordImageSourceOnClient, type ImageTurnContext } from "./image-turn-receipts";
type Json = Record<string, unknown>;
const imageNames = new Set([imageSelectionToolName, imageExecutionToolName]);
export class ImageTurnSourceObserver {
  private readonly realCalls = new Map<string, { itemId: string | null; name: string; input?: unknown; partial: string }>();
  private readonly providerBlocks = new Map<number, string>();
  private readonly providerItems = new Map<string, string>();
  private readonly chatIndexes = new Map<number, string>();
  private readonly blocks = new Map<number, { id: string; name: string; input: unknown; partial: string }>();
  constructor(private readonly context: ImageTurnContext, private readonly requestId: string, private readonly allowedNames: ReadonlySet<string>) {}
  provider(event: Json) {
    const item = record(event.item);
    if (item?.type === "function_call" && imageCallIdDto.safeParse(item.call_id).success && imageCallIdDto.safeParse(item.id).success) {
      const id = String(item.call_id), itemId = String(item.id), name = String(item.name ?? "");
      const call = this.register(id, itemId, name);
      this.providerItems.set(itemId, id);
      if (typeof item.arguments === "string") call.partial = item.arguments;
    }
    const responseCall = this.realCalls.get(this.providerItems.get(String(event.item_id)) ?? "");
    if (responseCall && event.type === "response.function_call_arguments.delta") responseCall.partial += String(event.delta ?? "");
    if (responseCall && event.type === "response.function_call_arguments.done") responseCall.partial = String(event.arguments ?? "");
    const block = record(event.content_block);
    if (block?.type === "tool_use" && imageCallIdDto.safeParse(block.id).success) {
      const id = String(block.id), call = this.register(id, null, String(block.name ?? "")); call.input = block.input;
      this.providerBlocks.set(Number(event.index), id);
    }
    const anthropicCall = this.realCalls.get(this.providerBlocks.get(Number(event.index)) ?? ""), rawDelta = record(event.delta);
    if (anthropicCall && event.type === "content_block_delta" && rawDelta?.type === "input_json_delta") anthropicCall.partial += String(rawDelta.partial_json ?? "");
    for (const choice of Array.isArray(event.choices) ? event.choices : []) {
      const delta = record(record(choice)?.delta);
      for (const call of Array.isArray(delta?.tool_calls) ? delta.tool_calls : []) {
        const value = record(call), fn = record(value?.function), index = Number(value?.index ?? 0);
        if (imageCallIdDto.safeParse(value?.id).success) this.chatIndexes.set(index, String(value!.id));
        const id = this.chatIndexes.get(index);
        if (!id) continue;
        const current = this.realCalls.get(id), namePart = typeof fn?.name === "string" ? fn.name : "";
        const name = current && namePart && namePart !== current.name ? current.name + namePart : namePart || current?.name || "";
        const observed = this.register(id, null, name, true);
        if (typeof fn?.arguments === "string") observed.partial += fn.arguments;
      }
    }
  }
  private register(id: string, itemId: string | null, name: string, incrementalName = false) {
    const prior = this.realCalls.get(id);
    if (prior) {
      if (prior.itemId !== itemId || (!incrementalName && prior.name !== name)) throw this.invalid();
      if (incrementalName) prior.name = name;
      return prior;
    }
    const value = { itemId, name, partial: "", input: undefined as unknown };
    this.realCalls.set(id, value); return value;
  }
  async output(event: Json, protocol: GatewayProtocol) {
    if (protocol !== "anthropic") return;
    const block = record(event.content_block), index = Number(event.index);
    if (event.type === "content_block_start" && block?.type === "tool_use" && imageNames.has(String(block.name))) {
      this.blocks.set(index, { id: String(block.id), name: String(block.name), input: block.input, partial: "" });
    }
    const pending = this.blocks.get(index);
    if (!pending) return;
    const delta = record(event.delta);
    if (event.type === "content_block_delta" && delta?.type === "input_json_delta") pending.partial += String(delta.partial_json ?? "");
    if (event.type !== "content_block_stop") return;
    this.blocks.delete(index);
    let args: unknown;
    try { args = pending.partial ? JSON.parse(pending.partial) : pending.input; } catch { throw this.invalid(); }
    await this.persist(pending.id, pending.name, args);
  }
  async json(provider: Json, output: Json) {
    for (const item of Array.isArray(provider.output) ? provider.output : []) this.provider({ item });
    for (const block of Array.isArray(provider.content) ? provider.content : []) this.provider({ content_block: block });
    for (const choice of Array.isArray(provider.choices) ? provider.choices : []) {
      const message = record(record(choice)?.message);
      this.provider({ choices: [{ delta: message }] });
    }
    for (const block of Array.isArray(output.content) ? output.content : []) {
      const value = record(block);
      if (value?.type === "tool_use" && imageNames.has(String(value.name))) await this.persist(String(value.id), String(value.name), value.input);
    }
  }
  private invalid() { return new GatewayError("IMAGE_TURN_SOURCE_INVALID", "The image proposal has no matching Provider call identity or valid parameters", 502, "upstream_error"); }
  private async persist(id: string, name: string, args: unknown) {
    const actual = this.realCalls.get(id);
    let actualArgs: unknown;
    try {
      actualArgs = actual?.partial ? JSON.parse(actual.partial) : actual?.input;
      if (!actual || !this.allowedNames.has(name) || actual.name !== name || operationInputDigest(actualArgs) !== operationInputDigest(args)) throw this.invalid();
    } catch { throw this.invalid(); }
    if (name === imageSelectionToolName && !imageSelectionArgumentsDto.safeParse(args).success) throw this.invalid();
    await withPlatformTransaction(client => recordImageSourceOnClient(client, this.context, {
      call_id: id, output_item_id: actual.itemId, gateway_request_id: this.requestId,
      tool_name: name as typeof imageSelectionToolName | typeof imageExecutionToolName, arguments_sha256: operationInputDigest(args),
    }));
  }
}
