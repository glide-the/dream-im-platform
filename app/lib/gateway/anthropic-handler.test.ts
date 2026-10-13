import { beforeEach, describe, expect, it, vi } from "vitest";
// [Input] Public Messages/count_tokens DTOs and isolated authentication/provider boundaries.
// [Output] Original orchestration and identical visual history projection for Anthropic counting.
// [Pos] Gateway handler technical contracts, without real model acceptance.
// [Sync] 2026-10-10: cover native history counting after an AI model switch.
import { handleAnthropicMessages, handleAnthropicCountTokens } from "./anthropic-handler";
import sharp from "sharp";
import { nativeHistoryForAnthropic } from "./protocol-adapters";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), nonStreaming: vi.fn(), streaming: vi.fn(), authenticate: vi.fn(), resolve: vi.fn(), count: vi.fn() }));
vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../models/resolver", () => ({ resolveBillableModel: mocks.resolve }));
vi.mock("./provider-clients", async (importOriginal) => ({ ...(await importOriginal<typeof import("./provider-clients")>()), createAnthropicProviderClient: () => ({messages:{countTokens:mocks.count}}) }));
vi.mock("./prepare", async (importOriginal) => ({ ...(await importOriginal<typeof import("./prepare")>()), prepareGatewayRequest: mocks.prepare }));
vi.mock("./proxy-handler", async (importOriginal) => ({ ...(await importOriginal<typeof import("./proxy-handler")>()), proxyNonStreaming: mocks.nonStreaming, proxyStreaming: mocks.streaming }));

const ready = {
  kind: "ready" as const,
  value: {
    requestId: "req_test",
    effectiveMaxOutputTokens: 512,
    resolved: { provider: { protocol: "anthropic" as const }, model: { upstreamModel: "claude-upstream" } },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(ready);
  mocks.nonStreaming.mockResolvedValue(Response.json({ type: "message" }));
  mocks.streaming.mockResolvedValue(new Response("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", { headers: { "content-type": "text/event-stream" } }));
});

describe("Anthropic gateway handler orchestration", () => {
  it("captures the exact JSON request and dispatches non-streaming", async () => {
    const raw = JSON.stringify({ model: "claude-writing", max_tokens: 1000, messages: [{ role: "user", content: "hello" }] });
    const response = await handleAnthropicMessages(new Request("http://localhost/v1/messages?beta=1", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret" }, body: raw }));
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ protocol: "anthropic", requestCapture: expect.objectContaining({ rawBody: raw }) }));
    expect(mocks.nonStreaming).toHaveBeenCalledWith(expect.objectContaining({ externalProtocol: "anthropic", body: expect.objectContaining({ model: "claude-writing" }) }));
  });

  it("dispatches stream=true to the incremental proxy", async () => {
    const response = await handleAnthropicMessages(new Request("http://localhost/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-writing", max_tokens: 128, stream: true, messages: [{ role: "user", content: "hello" }] }) }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mocks.streaming).toHaveBeenCalledOnce();
  });

  it("derives a distinct reservation key for each body in one Dream turn", async () => {
    const headers = {
      "content-type": "application/json",
      "x-ink-turn-idempotency-key": `dream-turn-${"a".repeat(64)}`,
    };
    const body = JSON.stringify({ model: "claude-writing", max_tokens: 128, stream: true, messages: [{ role: "user", content: "hello" }] });
    await handleAnthropicMessages(new Request("http://localhost/v1/messages", { method: "POST", headers, body }));
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^turn-[a-f0-9]{24}-request-[a-f0-9]{64}$/),
    }));
  });

  it("accepts Claude Code message-level system control entries", async () => {
    const response = await handleAnthropicMessages(new Request("http://localhost/v1/messages?beta=true", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-beta": "claude-code-20250219" },
      body: JSON.stringify({
        model: "claude-writing",
        max_tokens: 128,
        stream: true,
        system: [{ type: "text", text: "top-level system" }],
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          { role: "system", content: [{ type: "text", text: "runtime control" }] },
        ],
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    expect(mocks.streaming).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ messages: expect.arrayContaining([expect.objectContaining({ role: "system" })]) }),
    }));
  });

  it("rejects invalid JSON before reservation", async () => {
    const response = await handleAnthropicMessages(new Request("http://localhost/v1/messages", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("counts a native image history using the same visual projection as Anthropic Messages", async () => {
    const data=(await sharp({create:{width:8,height:8,channels:3,background:"blue"}}).png().toBuffer()).toString("base64");
    const body={model:"selected-anthropic",messages:[{role:"assistant",content:[
      {type:"text",text:"Before"},{type:"server_tool_use",id:"ig_original",name:"image_generation",input:{}},
      {type:"image_generation_tool_result",tool_use_id:"ig_original",content:[{type:"image",source:{type:"base64",media_type:"image/png",data}}]},
      {type:"text",text:"After"}]}]};
    mocks.authenticate.mockResolvedValue({platformUserId:"same-owner"});
    mocks.resolve.mockResolvedValue({provider:{protocol:"anthropic"},model:{upstreamModel:"actual-anthropic"}});
    mocks.count.mockResolvedValue({input_tokens:100});
    const response=await handleAnthropicCountTokens(new Request("https://gateway.example/v1/messages/count_tokens",{method:"POST",body:JSON.stringify(body)}));
    expect(response.status).toBe(200);
    expect(mocks.count).toHaveBeenCalledWith({...nativeHistoryForAnthropic(body),model:"actual-anthropic"},expect.objectContaining({signal:expect.any(AbortSignal)}));
    const sent=mocks.count.mock.calls[0][0];
    expect(sent).not.toHaveProperty("max_tokens");expect(sent).not.toHaveProperty("stream");
    expect(JSON.stringify(sent)).not.toContain("server_tool_use");expect(JSON.stringify(sent)).not.toContain("image_generation_tool_result");
    expect(sent.messages.map((message:{role:string})=>message.role)).toEqual(["assistant","user","assistant"]);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
