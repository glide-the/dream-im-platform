import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOpenAIChatCompletions } from "./openai-handler";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), nonStreaming: vi.fn(), streaming: vi.fn() }));
vi.mock("./prepare", async (importOriginal) => ({ ...(await importOriginal<typeof import("./prepare")>()), prepareGatewayRequest: mocks.prepare }));
vi.mock("./proxy-handler", async (importOriginal) => ({ ...(await importOriginal<typeof import("./proxy-handler")>()), proxyNonStreaming: mocks.nonStreaming, proxyStreaming: mocks.streaming }));

const ready = { kind: "ready" as const, value: { requestId: "req_openai", effectiveMaxOutputTokens: 256, resolved: { provider: { protocol: "openai" as const }, model: { upstreamModel: "gpt-upstream" } } } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(ready);
  mocks.nonStreaming.mockResolvedValue(Response.json({ object: "chat.completion" }));
  mocks.streaming.mockResolvedValue(new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
});

describe("OpenAI chat gateway handler orchestration", () => {
  it("preserves the application request and output limit", async () => {
    const raw = JSON.stringify({ model: "gpt-writing", messages: [{ role: "user", content: "hello" }], max_completion_tokens: 2000 });
    const response = await handleOpenAIChatCompletions(new Request("http://localhost/v1/chat/completions", { method: "POST", body: raw }));
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ protocol: "openai", requestedMaxOutputTokens: 2000, requestCapture: expect.objectContaining({ rawBody: raw }) }));
    expect(mocks.nonStreaming).toHaveBeenCalledOnce();
  });

  it("uses the streaming proxy for stream=true", async () => {
    const response = await handleOpenAIChatCompletions(new Request("http://localhost/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "gpt-writing", messages: [{ role: "user", content: "hello" }], stream: true }) }));
    expect(await response.text()).toContain("[DONE]");
    expect(mocks.streaming).toHaveBeenCalledOnce();
  });
});
