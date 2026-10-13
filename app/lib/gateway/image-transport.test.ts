// [Input] Mocked static/managed credentials, fetch responses, abort signals, and Image error envelopes.
// [Output] Images transport evidence for pre-abort, timeout, one 401 renewal, and reliable error usage.
// [Pos] Provider-free low-level Images transport regression.
// [Sync] 2026-10-09: cover dispatch fences, bounded failures, and one managed credential renewal.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ImageProviderHttpError,
  sendImageProviderRequest,
} from "./image-transport";
import { ProviderTimeoutError } from "./provider-transport";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  credential: vi.fn(),
  record: vi.fn(),
}));

vi.mock("./managed-provider-credentials", () => ({ resolveManagedProviderImageAccess: mocks.access }));
vi.mock("./repository", () => ({ recordGatewayProviderCredentialUse: mocks.record }));
vi.mock("./provider-endpoint", () => ({ resolveProviderBaseUrl: (input: { baseUrl: string }) => input.baseUrl }));
vi.mock("./provider-transport", async (original) => ({
  ...(await original<typeof import("./provider-transport")>()),
  resolveProviderCredential: mocks.credential,
}));

const genericResolved = {
  model: { id: "m", code: "image", upstreamModel: "gpt-image", displayName: "Image", capabilities: {}, requestHeaders: {} },
  provider: { id: "p", code: "openai", protocol: "openai" as const, baseUrl: "http://127.0.0.1:49999", adapterKind: "generic" as const, timeoutMs: 20, maxRetries: 0, config: { imageApi: { kind: "openai" } } },
  pricingRuleId: "price",
  pricing: { inputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0, cacheReadPriceMicrousdPerMillion: 0, cacheWritePriceMicrousdPerMillion: 0, markupBps: 0, discountBps: 0 },
  limits: {},
};

const codexResolved = {
  ...genericResolved,
  provider: {
    ...genericResolved.provider,
    adapterKind: "codex" as const,
    activeCredentialKind: "managed_oauth" as const,
    authEpoch: 1,
    managedAccountId: "account",
    managedAccountAuthEpoch: 1,
    credentialRevision: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.credential.mockReturnValue("secret");
  mocks.record.mockResolvedValue(undefined);
});

describe("Images Provider transport", () => {
  it("does not fetch when the downstream signal is already aborted", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    await expect(sendImageProviderRequest({
      resolved: genericResolved,
      operation: "images.generations",
      body: { model: "gpt-image", prompt: "draw" },
      requestSignal: controller.signal,
      gatewayRequestId: "req",
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("aborts a stalled fetch with the configured Provider timeout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    await expect(sendImageProviderRequest({
      resolved: genericResolved,
      operation: "images.generations",
      body: { model: "gpt-image", prompt: "draw" },
      requestSignal: new AbortController().signal,
      gatewayRequestId: "req",
    })).rejects.toBeInstanceOf(ProviderTimeoutError);
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockRestore();
  });

  it("renews a Codex credential once after 401 and preserves the dispatch fence", async () => {
    mocks.access
      .mockResolvedValueOnce({ generationsUrl: "https://codex.test/gen", editsUrl: "https://codex.test/edit", headers: new Headers({ authorization: "Bearer old" }), credentialRevision: 1, renewed: false, accountId: "account", accountAuthEpoch: 1 })
      .mockResolvedValueOnce({ generationsUrl: "https://codex.test/gen", editsUrl: "https://codex.test/edit", headers: new Headers({ authorization: "Bearer new" }), credentialRevision: 2, renewed: true, accountId: "account", accountAuthEpoch: 1 });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const dispatched = vi.fn();
    const result = await sendImageProviderRequest({
      resolved: codexResolved,
      operation: "images.generations",
      body: { model: "gpt-image", prompt: "draw" },
      requestSignal: new AbortController().signal,
      gatewayRequestId: "req",
      onDispatch: dispatched,
    });
    expect(result.response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatched).toHaveBeenCalledTimes(2);
    expect(mocks.access).toHaveBeenLastCalledWith(expect.objectContaining({ forceRenew: true }));
    result.cleanup();
    fetchMock.mockRestore();
  });

  it("attaches only internally consistent usage from a non-2xx response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      error: { message: "busy" },
      usage: {
        total_tokens: 13,
        input_tokens: 3,
        output_tokens: 10,
        input_tokens_details: { text_tokens: 3, image_tokens: 0 },
        output_tokens_details: { text_tokens: 0, image_tokens: 10 },
      },
    }), { status: 503, headers: { "content-type": "application/json", "x-request-id": "upstream" } }));
    try {
      await sendImageProviderRequest({
        resolved: genericResolved,
        operation: "images.generations",
        body: { model: "gpt-image", prompt: "draw" },
        requestSignal: new AbortController().signal,
        gatewayRequestId: "req",
      });
      throw new Error("expected Provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ImageProviderHttpError);
      expect((error as ImageProviderHttpError).usage).toMatchObject({ inputTextTokens: 3, outputImageTokens: 10 });
    }
    fetchMock.mockRestore();
  });
});
