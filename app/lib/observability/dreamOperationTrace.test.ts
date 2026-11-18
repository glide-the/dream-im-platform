// [Input] The production operation route with in-memory Next request and child spans.
// [Output] Concrete names for registered operations and a bounded fallback for unknown names.
// [Pos] Provider-free trace naming and dispatch contract.
import { beforeEach, expect, it, vi } from "vitest";
import { context, ROOT_CONTEXT, SpanStatusCode, trace, type Span } from "next/dist/compiled/@opentelemetry/api";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { registerDreamOperationTrace, traceDreamOperationStep } from "./dreamOperationTrace";

const mocks = vi.hoisted(() => ({ tracer: vi.fn(), resolve: vi.fn(), fallback: vi.fn() }));
vi.mock("next/dist/server/lib/trace/tracer", () => ({ getTracer: mocks.tracer }));
vi.mock("next/dist/compiled/@opentelemetry/api", async original => {
  const api = await original<typeof import("next/dist/compiled/@opentelemetry/api")>();
  return {
    ...api,
    context: { active: vi.fn(), with: vi.fn() },
    trace: { getActiveSpan: vi.fn(), getTracer: vi.fn() },
  };
});
vi.mock("../dream/deckDefaultPluginResolveHandler", async original => ({
  ...await original<typeof import("../dream/deckDefaultPluginResolveHandler")>(),
  handleDeckDefaultPluginResolve: mocks.resolve,
}));
vi.mock("../dream/chatThreadHandler", async original => ({
  ...await original<typeof import("../dream/chatThreadHandler")>(), handleChatThreadOperation: mocks.fallback,
}));

const prefix = "/api/internal/dream/v1/operations/";
const template = `${prefix}[operation]`;
const attributes = new Map<string, string>();
const span = { isRecording: () => true, setAttribute: vi.fn(), setStatus: vi.fn(), end: vi.fn() };
const startActiveSpan = vi.fn((_name, _options, invoke: (child: Span) => unknown) => invoke(span as unknown as Span));
let activeContext = ROOT_CONTEXT;
let server: { getRootSpanAttributes: () => Map<string, string>; trace: (...args: unknown[]) => unknown };

beforeEach(() => {
  vi.resetAllMocks();
  attributes.clear();
  attributes.set("next.route", template);
  activeContext = ROOT_CONTEXT;
  vi.mocked(context.active).mockImplementation(() => activeContext);
  vi.mocked(context.with).mockImplementation((scope, fn, thisArg, ...args) => {
    activeContext = scope;
    return fn.apply(thisArg, args);
  });
  vi.mocked(trace.getActiveSpan).mockReturnValue(span as unknown as Span);
  startActiveSpan.mockImplementation((_name, _options, invoke) => invoke(span as unknown as Span));
  vi.mocked(trace.getTracer).mockReturnValue({ startActiveSpan } as unknown as ReturnType<typeof trace.getTracer>);
  server = { getRootSpanAttributes: () => attributes, trace: (_type, _options, invoke) => (invoke as (active: typeof span) => unknown)(span) };
  mocks.tracer.mockReturnValue(server);
  registerDreamOperationTrace();
});

function callRoute(request: Request, operation: string): Promise<Response> {
  const options = { attributes: { "http.method": request.method, "http.target": new URL(request.url).pathname } };
  return server.trace("BaseServer.handleRequest", options, () => POST(request, { params: Promise.resolve({ operation }) })) as Promise<Response>;
}

it.each([200, 403])("names the registered operation and preserves status %i", async status => {
  const operation = "deck.default-plugin.resolve";
  const route = prefix + operation;
  const request = new Request(`http://admin.test${route}?opaque=excluded`, { method: "POST" });
  const response = new Response(null, { status });
  mocks.resolve.mockResolvedValue(response);

  expect(await callRoute(request, operation)).toBe(response);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(request, operation);
  expect(attributes.get("next.route")).toBe(route);
  expect(span.setAttribute).toHaveBeenCalledExactlyOnceWith("ink.dream.operation", operation);
  expect(startActiveSpan).toHaveBeenCalledExactlyOnceWith("handleDeckDefaultPluginResolve", {
    attributes: {
      "ink.dream.operation": operation,
      "code.function.name": "handleDeckDefaultPluginResolve",
      "code.file.path": "app/lib/dream/deckDefaultPluginResolveHandler.ts",
    },
  }, expect.any(Function));
});

it("keeps the shared template for unregistered path input", async () => {
  const operation = "unregistered.private-token";
  const request = new Request(`http://admin.test${prefix}${operation}`, { method: "POST" });
  const response = new Response(null, { status: 404 });
  mocks.fallback.mockResolvedValue(response);

  expect(await callRoute(request, operation)).toBe(response);
  expect(attributes.get("next.route")).toBe(template);
  expect(span.setAttribute).not.toHaveBeenCalled();
  expect(startActiveSpan).not.toHaveBeenCalled();
});

it("dispatches the original request without an active probe", async () => {
  const operation = "deck.default-plugin.resolve";
  const request = new Request(`http://admin.test${prefix}${operation}`, { method: "POST" });
  const response = new Response(null, { status: 200 });
  mocks.resolve.mockResolvedValue(response);
  vi.mocked(trace.getActiveSpan).mockReturnValue(undefined);

  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(request, operation);
  expect(startActiveSpan).not.toHaveBeenCalled();
});

it("ends the child span and forwards an operation exception without recording its message", async () => {
  const error = new Error("detail to exclude");
  const run = vi.fn().mockRejectedValue(error);
  await expect(traceDreamOperationStep("parseAuthDto", "app/lib/auth/internalHandler.ts", run)).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
  expect(span.setStatus).toHaveBeenCalledExactlyOnceWith({ code: SpanStatusCode.ERROR });
  expect(span.end).toHaveBeenCalledTimes(1);
});
